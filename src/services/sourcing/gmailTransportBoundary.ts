/**
 * Gmail execution boundary.
 *
 * A validated sourcing job specifies the approved sender. The transport layer
 * MUST send as that identity only — never substitute another authenticated
 * mailbox (including SmartProcure / personal / sibling company accounts).
 *
 * Preview / certification rebuild must not call executeGmailTransport.
 */

import { assertMailboxMatchesCompany } from "@/domain/companyMailboxRegistry";
import { assertNoGovernmentLeak } from "@/domain/supplierFacingEmail";

export type ValidatedSourcingJob = {
  bidInternalId: string;
  companyId: string;
  companyLegalName: string;
  companyTradingName?: string | null;
  companyRegistrationNumber?: string | null;
  approvedSenderGmail: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  supplierFacingReference: string;
  internalSourcingReference: string;
  subject: string;
  body: string;
  lineItems: Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    brandRequirement?: string | null;
  }>;
  attachmentPaths?: string[];
  createdAt: Date;
  sendStatus: "DRAFT_NOT_SENT" | "READY" | "SENT" | "FAILED" | "BLOCKED";
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  replyStatus?: string | null;
  /** Immutable once set for send approval */
  companyIdentityLocked: true;
};

export type GmailTransportExecutionResult = {
  status: "SENT" | "FAILED" | "REFUSED";
  gmailMessageId?: string;
  gmailThreadId?: string;
  senderIdentity: string;
  recipient: string;
  sentAt?: Date;
  error?: string;
};

export type GmailTransportAdapter = {
  /**
   * Must authenticate AS the given sender identity.
   * Must refuse if the live authenticated identity ≠ senderIdentity.
   */
  sendAs: (input: {
    senderIdentity: string;
    to: string;
    subject: string;
    bodyText: string;
  }) => Promise<{
    messageId: string;
    threadId: string;
    authenticatedAs: string;
  }>;
};

export type TransportValidation =
  | { ok: true }
  | { ok: false; code: string; blockers: string[] };

export function validateJobForTransport(
  job: ValidatedSourcingJob,
): TransportValidation {
  const blockers: string[] = [];

  const mailbox = assertMailboxMatchesCompany({
    legalName: job.companyLegalName,
    tradingName: job.companyTradingName,
    registrationNumber: job.companyRegistrationNumber,
    candidateGmail: job.approvedSenderGmail,
  });
  if (!mailbox.ok) {
    return { ok: false, code: mailbox.code, blockers: mailbox.blockers };
  }

  const leaks = assertNoGovernmentLeak(`${job.subject}\n${job.body}`);
  if (leaks.length) {
    blockers.push(`Supplier-facing leak: ${leaks.join(", ")}`);
  }
  if (/BID-\d+/i.test(job.subject)) {
    blockers.push("Internal BID identifier in supplier-facing subject");
  }
  if (!job.companyIdentityLocked) {
    blockers.push("Company identity not locked on sourcing job");
  }
  if (job.sendStatus === "SENT") {
    blockers.push("Job already marked SENT");
  }

  if (blockers.length) {
    return { ok: false, code: "BLOCKED_JOB_INVALID", blockers };
  }
  return { ok: true };
}

/**
 * Execute send through the boundary. Transport cannot choose a different sender.
 * Preview/certification scripts must not call this.
 */
export async function executeGmailTransport(
  job: ValidatedSourcingJob,
  adapter: GmailTransportAdapter,
  options?: { allowExecute?: boolean },
): Promise<GmailTransportExecutionResult> {
  if (!options?.allowExecute) {
    return {
      status: "REFUSED",
      senderIdentity: job.approvedSenderGmail,
      recipient: job.supplierEmail,
      error:
        "Gmail transport execution disabled — preview/certification must not send",
    };
  }

  const validation = validateJobForTransport(job);
  if (!validation.ok) {
    return {
      status: "REFUSED",
      senderIdentity: job.approvedSenderGmail,
      recipient: job.supplierEmail,
      error: validation.blockers.join("; "),
    };
  }

  try {
    const result = await adapter.sendAs({
      senderIdentity: job.approvedSenderGmail,
      to: job.supplierEmail,
      subject: job.subject,
      bodyText: job.body,
    });

    if (
      result.authenticatedAs.trim().toLowerCase() !==
      job.approvedSenderGmail.trim().toLowerCase()
    ) {
      return {
        status: "REFUSED",
        senderIdentity: job.approvedSenderGmail,
        recipient: job.supplierEmail,
        error: `Transport authenticated as ${result.authenticatedAs} — refused substitution for approved sender ${job.approvedSenderGmail}`,
      };
    }

    return {
      status: "SENT",
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      senderIdentity: job.approvedSenderGmail,
      recipient: job.supplierEmail,
      sentAt: new Date(),
    };
  } catch (e) {
    return {
      status: "FAILED",
      senderIdentity: job.approvedSenderGmail,
      recipient: job.supplierEmail,
      error: e instanceof Error ? e.message : "Transport failed",
    };
  }
}

export function buildValidatedSourcingJob(input: {
  bidInternalId: string;
  companyId: string;
  companyLegalName: string;
  companyTradingName?: string | null;
  companyRegistrationNumber?: string | null;
  approvedSenderGmail: string;
  supplierId: string;
  supplierName: string;
  supplierEmail: string;
  supplierFacingReference: string;
  internalSourcingReference: string;
  subject: string;
  body: string;
  lineItems: ValidatedSourcingJob["lineItems"];
  attachmentPaths?: string[];
}): ValidatedSourcingJob {
  return {
    ...input,
    createdAt: new Date(),
    sendStatus: "DRAFT_NOT_SENT",
    companyIdentityLocked: true,
  };
}
