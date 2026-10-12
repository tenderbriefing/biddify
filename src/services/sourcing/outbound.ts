import type { PrismaClient } from "@prisma/client";
import { evaluateOutboundGuards } from "@/domain/operationalGuards";
import { assertNoGovernmentLeak } from "@/domain/supplierFacingEmail";
import { evaluateRateLimits } from "@/domain/rateLimit";
import { writeAuditEvent } from "@/lib/audit";
import { decryptSecret } from "@/lib/crypto/tokenVault";
import { findSentByQuery, gmailSend } from "@/integrations/gmail/client";
import {
  getOAuthConfig,
  refreshAccessToken,
} from "@/integrations/gmail/oauth";

export type SendSourcingResult =
  | { ok: true; messageId: string; threadId: string; duplicate: boolean }
  | { ok: false; blockers: string[]; ambiguous?: boolean };

async function getSettings(prisma: PrismaClient) {
  return prisma.systemSettings.upsert({
    where: { id: "default" },
    create: { id: "default", globalOutboundPaused: true, outboundMode: "DISABLED" },
    update: {},
  });
}

async function resolveAccessToken(
  prisma: PrismaClient,
  gmailAccountId: string,
): Promise<string> {
  const account = await prisma.gmailAccount.findUnique({
    where: { id: gmailAccountId },
    include: { token: true },
  });
  if (!account?.token) throw new Error("Gmail token missing");
  const config = getOAuthConfig();
  if (!config) throw new Error("Gmail OAuth not configured");

  const expired =
    account.token.tokenExpiry &&
    account.token.tokenExpiry.getTime() < Date.now() + 60_000;

  if (!expired) {
    return decryptSecret(account.token.encryptedAccessToken);
  }
  if (!account.token.encryptedRefreshToken) {
    throw new Error("Access token expired and no refresh token");
  }
  const refreshed = await refreshAccessToken({
    config,
    refreshToken: decryptSecret(account.token.encryptedRefreshToken),
  });
  await prisma.gmailToken.update({
    where: { gmailAccountId },
    data: {
      encryptedAccessToken: (await import("@/lib/crypto/tokenVault")).encryptSecret(
        refreshed.access_token,
      ),
      tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}

/**
 * Idempotent supplier RFQ send. Never blind-retry on ambiguous Gmail status.
 */
export async function sendSourcingRequest(
  prisma: PrismaClient,
  sourcingRequestId: string,
  options?: { userId?: string },
): Promise<SendSourcingResult> {
  const settings = await getSettings(prisma);
  const req = await prisma.sourcingRequest.findUnique({
    where: { id: sourcingRequestId },
    include: {
      company: true,
      supplier: true,
      rfq: true,
      gmailAccount: true,
    },
  });
  if (!req) return { ok: false, blockers: ["Sourcing request not found"] };

  if (req.deliveryState === "SENT" && req.gmailMessageId) {
    return {
      ok: true,
      messageId: req.gmailMessageId,
      threadId: req.gmailThreadId ?? "",
      duplicate: true,
    };
  }

  const existingEmail = await prisma.emailMessage.findFirst({
    where: { idempotencyKey: req.idempotencyKey, deliveryState: "SENT" },
  });
  if (existingEmail?.gmailMessageId) {
    return {
      ok: true,
      messageId: existingEmail.gmailMessageId,
      threadId: existingEmail.gmailThreadId ?? "",
      duplicate: true,
    };
  }

  const guard = evaluateOutboundGuards({
    company: req.company,
    gmail: req.gmailAccount,
    rfq: req.rfq,
    supplier: req.supplier,
    approvedSenderGmail: req.approvedSenderGmail,
    globalOutboundPaused: settings.globalOutboundPaused,
    outboundMode: settings.outboundMode,
    isCertificationBatch: req.certificationBatch,
    founderApprovedCertification: Boolean(req.founderApprovedAt),
    workflowContext: "SUPPLIER_SOURCING",
  });
  if (!guard.allowed) {
    return { ok: false, blockers: guard.blockers };
  }

  if (
    req.approvedSenderGmail &&
    req.gmailAccount &&
    req.approvedSenderGmail.toLowerCase() !==
      req.gmailAccount.emailAddress.toLowerCase()
  ) {
    return {
      ok: false,
      blockers: [
        "BLOCKED_MAILBOX_COMPANY_MISMATCH: refusing to send — authenticated Gmail ≠ job-locked approved sender (no substitution)",
      ],
    };
  }

  const sinceHour = new Date(Date.now() - 3600_000);
  const sinceDay = new Date(Date.now() - 86400_000);
  const [sentLastHour, sentLastDay, sentToSupplier, sentByCompany] =
    await Promise.all([
      prisma.sourcingRequest.count({
        where: { deliveryState: "SENT", sentAt: { gte: sinceHour } },
      }),
      prisma.sourcingRequest.count({
        where: { deliveryState: "SENT", sentAt: { gte: sinceDay } },
      }),
      prisma.sourcingRequest.count({
        where: {
          supplierId: req.supplierId,
          deliveryState: "SENT",
          sentAt: { gte: sinceDay },
        },
      }),
      prisma.sourcingRequest.count({
        where: {
          companyId: req.companyId,
          deliveryState: "SENT",
          sentAt: { gte: sinceDay },
        },
      }),
    ]);

  const hoursSince =
    req.supplier.lastContactedAt == null
      ? null
      : (Date.now() - req.supplier.lastContactedAt.getTime()) / 3600000;

  const rate = evaluateRateLimits(
    {
      maxPerHour: settings.maxEmailsPerHour,
      maxPerDay: settings.maxEmailsPerDay,
      maxPerSupplierPerDay: settings.maxEmailsPerSupplierPerDay,
      maxPerCompanyPerDay: settings.maxEmailsPerCompanyPerDay,
      cooldownHours: settings.supplierCooldownHours,
    },
    {
      sentLastHour,
      sentLastDay,
      sentToSupplierLastDay: sentToSupplier,
      sentByCompanyLastDay: sentByCompany,
      hoursSinceSupplierContact: hoursSince,
    },
  );
  if (!rate.allowed) {
    return { ok: false, blockers: rate.blockers };
  }

  if (!req.gmailAccountId || !req.gmailAccount) {
    return { ok: false, blockers: ["No Gmail account on sourcing request"] };
  }

  const leaks = assertNoGovernmentLeak(`${req.subject}\n${req.body}`);
  if (leaks.length > 0) {
    return {
      ok: false,
      blockers: [
        `Supplier-facing content leaks restricted terms: ${leaks.join(", ")}`,
      ],
    };
  }

  const accessToken = await resolveAccessToken(prisma, req.gmailAccountId);

  // Ambiguous prior attempt? Check Sent before sending (neutral external ref).
  const sentMarker = req.externalReference ?? req.reference;
  const prior = await findSentByQuery({
    accessToken,
    query: `"${sentMarker}"`,
  });
  if (prior[0]) {
    await prisma.sourcingRequest.update({
      where: { id: req.id },
      data: {
        deliveryState: "SENT",
        sentAt: new Date(),
        gmailMessageId: prior[0].id,
        gmailThreadId: prior[0].threadId,
      },
    });
    return {
      ok: true,
      messageId: prior[0].id,
      threadId: prior[0].threadId,
      duplicate: true,
    };
  }

  const fromAddress = req.approvedSenderGmail ?? req.gmailAccount.emailAddress;
  if (
    fromAddress.toLowerCase() !== req.gmailAccount.emailAddress.toLowerCase()
  ) {
    return {
      ok: false,
      blockers: [
        "BLOCKED_MAILBOX_COMPANY_MISMATCH: transport cannot substitute a different sender",
      ],
    };
  }

  const sendResult = await gmailSend({
    accessToken,
    from: fromAddress,
    to: req.recipientEmail,
    subject: req.subject,
    bodyText: req.body,
  });

  if (sendResult.status === "AMBIGUOUS") {
    await prisma.sourcingRequest.update({
      where: { id: req.id },
      data: {
        deliveryState: "FAILED",
        errorMessage: `AMBIGUOUS: ${sendResult.error} — verify Sent before retry`,
      },
    });
    await writeAuditEvent({
      action: "EMAIL_SEND_FAILED",
      entityType: "SourcingRequest",
      entityId: req.id,
      userId: options?.userId,
      metadata: { ambiguous: true, error: sendResult.error },
    });
    return {
      ok: false,
      blockers: [`Ambiguous Gmail send — do not retry blindly: ${sendResult.error}`],
      ambiguous: true,
    };
  }

  if (sendResult.status === "FAILED") {
    await prisma.sourcingRequest.update({
      where: { id: req.id },
      data: { deliveryState: "FAILED", errorMessage: sendResult.error },
    });
    await writeAuditEvent({
      action: "EMAIL_SEND_FAILED",
      entityType: "SourcingRequest",
      entityId: req.id,
      userId: options?.userId,
      metadata: { error: sendResult.error },
    });
    return { ok: false, blockers: [sendResult.error] };
  }

  await prisma.$transaction([
    prisma.sourcingRequest.update({
      where: { id: req.id },
      data: {
        deliveryState: "SENT",
        sentAt: new Date(),
        gmailMessageId: sendResult.messageId,
        gmailThreadId: sendResult.threadId,
        errorMessage: null,
      },
    }),
    prisma.emailMessage.create({
      data: {
        gmailAccountId: req.gmailAccountId,
        companyId: req.companyId,
        rfqId: req.rfqId,
        supplierId: req.supplierId,
        sourcingRequestId: req.id,
        direction: "OUTBOUND",
        gmailMessageId: sendResult.messageId,
        gmailThreadId: sendResult.threadId,
        sender: req.gmailAccount.emailAddress,
        recipients: req.recipientEmail,
        subject: req.subject,
        bodyText: req.body,
        classification: "SUPPLIER_RFQ",
        deliveryState: "SENT",
        workflow: "SUPPLIER_SOURCING",
        idempotencyKey: req.idempotencyKey,
        isMock: false,
        sentAt: new Date(),
      },
    }),
    prisma.supplier.update({
      where: { id: req.supplierId },
      data: {
        lastContactedAt: new Date(),
        rfqsRequestedCount: { increment: 1 },
      },
    }),
  ]);

  await writeAuditEvent({
    action: "EMAIL_SENT",
    entityType: "SourcingRequest",
    entityId: req.id,
    userId: options?.userId,
    newState: {
      messageId: sendResult.messageId,
      threadId: sendResult.threadId,
      reference: req.reference,
    },
  });

  return {
    ok: true,
    messageId: sendResult.messageId,
    threadId: sendResult.threadId,
    duplicate: false,
  };
}
