/**
 * Phase 4 CERTIFICATION SEND — exactly 3 Founder-approved supplier emails.
 * Pre-send validation → temporary kill-switch release → send → verify → re-pause.
 * Autonomous sourcing remains OFF. Stops after report.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { sendSourcingRequest } from "../src/services/sourcing/outbound";
import { evaluateOutboundGuards } from "../src/domain/operationalGuards";
import { assertNoGovernmentLeak } from "../src/domain/supplierFacingEmail";
import { writeAuditEvent } from "../src/lib/audit";
import { decryptSecret } from "../src/lib/crypto/tokenVault";
import { findSentByQuery } from "../src/integrations/gmail/client";
import {
  getOAuthConfig,
  refreshAccessToken,
} from "../src/integrations/gmail/oauth";

const APPROVED = [
  { name: "Erom Wholesalers", email: "sales@erom.co.za" },
  { name: "Bidvest Waltons", email: "rfq@waltons.co.za" },
  { name: "Makro South Africa (Massmart)", email: "commercialonline@makro.co.za" },
] as const;

const EXPECTED_QTY: Array<{ match: RegExp; qty: number; label: string }> = [
  { match: /dishwashing/i, qty: 60, label: "dishwashing liquid" },
  { match: /towel\s*paper|paper\s*towel/i, qty: 75, label: "paper towel" },
  { match: /cotton\s*wool/i, qty: 100, label: "cotton wool" },
  { match: /\bAA\b/i, qty: 240, label: "AA batteries" },
  { match: /duracell|\bAAA\b/i, qty: 150, label: "AAA Duracell" },
];

async function resolveAccessToken(gmailAccountId: string): Promise<string> {
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
  if (!expired) return decryptSecret(account.token.encryptedAccessToken);
  if (!account.token.encryptedRefreshToken) {
    throw new Error("Access token expired and no refresh token");
  }
  const refreshed = await refreshAccessToken({
    config,
    refreshToken: decryptSecret(account.token.encryptedRefreshToken),
  });
  const { encryptSecret } = await import("../src/lib/crypto/tokenVault");
  await prisma.gmailToken.update({
    where: { gmailAccountId },
    data: {
      encryptedAccessToken: encryptSecret(refreshed.access_token),
      tokenExpiry: new Date(Date.now() + refreshed.expires_in * 1000),
    },
  });
  return refreshed.access_token;
}

function qtyChecks(lines: Array<{ description: string; quantity: unknown; brandRequirement: string | null }>) {
  const text = lines
    .map((l) => `${l.description} ${l.brandRequirement ?? ""}`)
    .join(" | ");
  const issues: string[] = [];
  for (const expected of EXPECTED_QTY) {
    const line = lines.find((l) =>
      expected.match.test(`${l.description} ${l.brandRequirement ?? ""}`),
    );
    if (!line) {
      issues.push(`Missing expected line matching "${expected.label}"`);
      continue;
    }
    if (Number(line.quantity) !== expected.qty) {
      issues.push(
        `Qty mismatch for "${expected.label}": expected ${expected.qty}, got ${Number(line.quantity)}`,
      );
    }
  }
  if (!/duracell/i.test(text)) issues.push("Duracell brand constraint missing");
  return issues;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const founderExecute = process.argv.includes("--founder-execute-send");

  // Hard stop: mailbox recertification / preview tasks must not send.
  if (!founderExecute) {
    console.log(
      JSON.stringify(
        {
          STATUS: "REFUSED",
          SEND_EXECUTED: false,
          code: "CERTIFICATION_SEND_LOCKED",
          reason:
            "Founder must approve the mailbox recertification report before any supplier email is sent. Re-run only with explicit --founder-execute-send after approval.",
          AUTONOMOUS_SOURCING: "OFF",
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  const company = await prisma.company.findFirst({
    where: { registrationNumber: "2014/277853/07", isDemo: false },
  });
  if (!company) throw new Error("ORISON CHEMICALS not found");

  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000011", isRealSource: true },
    include: { lineItems: { orderBy: { lineNumber: "asc" } } },
  });
  if (!rfq) throw new Error("BID-000011 missing");

  const gmail = await prisma.gmailAccount.findFirst({
    where: {
      companyId: company.id,
      connectionStatus: "CONNECTED",
    },
  });

  const drafts = await prisma.sourcingRequest.findMany({
    where: {
      rfqId: rfq.id,
      certificationBatch: true,
      deliveryState: "DRAFT_NOT_SENT",
    },
    include: { supplier: true },
    orderBy: { reference: "asc" },
  });

  const blockers: string[] = [];

  if (!gmail) blockers.push("Authenticated Gmail not connected/mapped to Orison Chemicals");
  if (gmail && !gmail.sendingEnabled) blockers.push("Gmail sending not enabled");
  if (!company.outboundSourcingEnabled) blockers.push("Company outbound not enabled");
  if (
    !company.authorisedSourcingSignatoryName ||
    !company.authorisedSourcingSignatoryConfirmedAt
  ) {
    blockers.push(
      "Authorised sourcing signatory not confirmed (CSD contact must not be used)",
    );
  }
  if (
    gmail &&
    company.authorisedSourcingSignatoryEmail &&
    company.authorisedSourcingSignatoryEmail.toLowerCase() !==
      gmail.emailAddress.toLowerCase()
  ) {
    blockers.push("Signatory email ≠ authenticated Gmail");
  }
  if (drafts.length !== 3) blockers.push(`Expected 3 drafts, found ${drafts.length}`);

  const recipientSet = new Set(drafts.map((d) => d.recipientEmail.toLowerCase()));
  for (const a of APPROVED) {
    if (!recipientSet.has(a.email.toLowerCase())) {
      blockers.push(`Missing approved recipient ${a.email}`);
    }
  }
  if (recipientSet.size !== 3) blockers.push("Recipient set is not exactly the 3 approved emails");

  const qtyIssues = qtyChecks(
    rfq.lineItems.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      brandRequirement: l.brandRequirement,
    })),
  );
  blockers.push(...qtyIssues);

  for (const d of drafts) {
    const leaks = assertNoGovernmentLeak(`${d.subject}\n${d.body}`);
    if (leaks.length) {
      blockers.push(`${d.reference} leaks: ${leaks.join(", ")}`);
    }
    if (/thapelo/i.test(d.body)) {
      blockers.push(`${d.reference} uses CSD contact Thapelo as signatory`);
    }
  }

  const alreadySent = await prisma.sourcingRequest.findMany({
    where: {
      rfqId: rfq.id,
      certificationBatch: true,
      deliveryState: "SENT",
    },
  });
  if (alreadySent.length > 0) {
    blockers.push(
      `Previous equivalent certification sends exist (${alreadySent.length}) — refuse duplicate batch`,
    );
  }

  const idemKeys = drafts.map((d) => d.idempotencyKey);
  if (new Set(idemKeys).size !== drafts.length) {
    blockers.push("Idempotency keys are not unique");
  }

  // Ensure controls are set for certification (except kill switch — toggled around send)
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      outboundMode: "CERTIFICATION",
      globalOutboundPaused: true,
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
    update: {
      outboundMode: "CERTIFICATION",
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
  });

  if (gmail) {
    for (const d of drafts) {
      const guard = evaluateOutboundGuards({
        company,
        gmail: {
          companyId: gmail.companyId,
          emailAddress: gmail.emailAddress,
          sendingEnabled: true, // intended post-enable
          connectionStatus: gmail.connectionStatus,
        },
        rfq,
        supplier: d.supplier,
        globalOutboundPaused: false,
        outboundMode: "CERTIFICATION",
        isCertificationBatch: true,
        founderApprovedCertification: true,
        workflowContext: "SUPPLIER_SOURCING",
      });
      if (!guard.allowed) {
        blockers.push(`${d.reference}: ${guard.blockers.join("; ")}`);
      }
    }
  }

  if (blockers.length > 0) {
    console.log(
      JSON.stringify(
        {
          STATUS: "BLOCKED",
          SEND_EXECUTED: false,
          blockers,
          AUTHENTICATED_EMAIL: gmail?.emailAddress ?? null,
          MAPPED_COMPANY: company.legalName,
          AUTHORISED_SOURCING_SIGNATORY:
            company.authorisedSourcingSignatoryName ?? null,
        },
        null,
        2,
      ),
    );
    process.exit(2);
  }

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          STATUS: "DRY_RUN_PASSED",
          SEND_EXECUTED: false,
          wouldSend: drafts.map((d) => ({
            to: d.recipientEmail,
            supplier: d.supplier.name,
            subject: d.subject,
            externalReference: d.externalReference,
            internalReference: d.reference,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  // Enable sending + temporary kill-switch release for this batch only
  await prisma.gmailAccount.update({
    where: { id: gmail!.id },
    data: { sendingEnabled: true },
  });
  await prisma.company.update({
    where: { id: company.id },
    data: { outboundSourcingEnabled: true },
  });
  await prisma.systemSettings.update({
    where: { id: "default" },
    data: {
      globalOutboundPaused: false,
      outboundMode: "CERTIFICATION",
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
  });

  const approvedAt = new Date();
  await prisma.sourcingRequest.updateMany({
    where: { id: { in: drafts.map((d) => d.id) } },
    data: {
      founderApprovedAt: approvedAt,
      founderApprovedBy:
        "FOUNDER_CERTIFICATION_AUTHORISATION — Phase 4 three-message batch",
      gmailAccountId: gmail!.id,
    },
  });

  const results = [];
  let ambiguous = false;

  for (const d of drafts) {
    const result = await sendSourcingRequest(prisma, d.id);
    if (!result.ok && result.ambiguous) {
      ambiguous = true;
      results.push({
        supplier: d.supplier.name,
        recipient: d.recipientEmail,
        status: "AMBIGUOUS",
        blockers: result.blockers,
        internalReference: d.reference,
        externalReference: d.externalReference,
        idempotencyKey: d.idempotencyKey,
      });
      break; // DO NOT RETRY / continue blind
    }
    if (!result.ok) {
      results.push({
        supplier: d.supplier.name,
        recipient: d.recipientEmail,
        status: "FAILED",
        blockers: result.blockers,
        internalReference: d.reference,
        externalReference: d.externalReference,
        idempotencyKey: d.idempotencyKey,
      });
      break;
    }

    let sentFolderConfirmed = false;
    try {
      const token = await resolveAccessToken(gmail!.id);
      const marker = d.externalReference ?? d.reference;
      const found = await findSentByQuery({
        accessToken: token,
        query: `"${marker}"`,
      });
      sentFolderConfirmed = found.some((m) => m.id === result.messageId);
    } catch {
      sentFolderConfirmed = false;
    }

    results.push({
      supplier: d.supplier.name,
      recipient: d.recipientEmail,
      gmailSender: gmail!.emailAddress,
      company: company.legalName,
      signatory: company.authorisedSourcingSignatoryName,
      gmailMessageId: result.messageId,
      threadId: result.threadId,
      timestamp: new Date().toISOString(),
      internalSourcingReference: d.reference,
      supplierFacingReference: d.externalReference,
      sentFolderConfirmation: sentFolderConfirmed,
      idempotencyKey: d.idempotencyKey,
      sendStatus: result.duplicate ? "ALREADY_SENT_IDEMPOTENT" : "SENT",
      duplicate: result.duplicate,
    });
  }

  // Re-pause immediately; keep autonomous OFF
  await prisma.systemSettings.update({
    where: { id: "default" },
    data: {
      globalOutboundPaused: true,
      outboundMode: "CERTIFICATION",
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
  });

  await writeAuditEvent({
    action: "CERTIFICATION_SEND_BATCH",
    entityType: "Rfq",
    entityId: rfq.id,
    metadata: {
      results,
      ambiguous,
      autonomousSourcing: "OFF",
    },
  });

  const sentCount = results.filter(
    (r) => r.sendStatus === "SENT" || r.sendStatus === "ALREADY_SENT_IDEMPOTENT",
  ).length;
  const dupCount = results.filter((r) => r.duplicate === true).length;

  console.log(
    JSON.stringify(
      {
        REPORT: "BIDDIFY — PHASE 4 CERTIFICATION SEND REPORT",
        STATUS:
          sentCount === 3 && !ambiguous
            ? "OUTBOUND_CERTIFICATION_PASSED"
            : "OUTBOUND_CERTIFICATION_INCOMPLETE",
        AUTHENTICATED_EMAIL: gmail!.emailAddress,
        MAPPED_COMPANY: company.legalName,
        AUTHORISED_SOURCING_SIGNATORY: company.authorisedSourcingSignatoryName,
        SENDS: results,
        SUMMARY: {
          intendedEmails: 3,
          providerSends: sentCount,
          duplicateSends: dupCount,
          ambiguousHalt: ambiguous,
        },
        CONTROLS_AFTER: {
          globalOutboundPaused: true,
          outboundMode: "CERTIFICATION",
          autonomyAuthorisedAt: null,
          autonomousSourcing: "OFF",
        },
        NEXT:
          "STOP. Autonomous sourcing remains OFF. Founder reviews this report before any further activation.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
