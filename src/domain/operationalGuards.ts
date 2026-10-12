/**
 * Operational vs TEST/DEMO separation.
 * Real RFQs must never send via DEMO entities or invent commercial evidence.
 */

import {
  assertApprovedSignatory,
  assertMailboxMatchesCompany,
} from "./companyMailboxRegistry";

export type GuardEntity = {
  isDemo?: boolean | null;
  dataMode?: "TEST" | "OPERATIONAL" | null;
};

export type OutboundGuardInput = {
  company: GuardEntity & {
    id: string;
    legalName?: string | null;
    tradingName?: string | null;
    registrationNumber?: string | null;
    outboundSourcingEnabled?: boolean | null;
    authorisedSourcingSignatoryName?: string | null;
    authorisedSourcingSignatoryEmail?: string | null;
    authorisedSourcingSignatoryConfirmedAt?: Date | null;
    approvedSourcingMailbox?: string | null;
  };
  gmail?: {
    companyId?: string | null;
    emailAddress?: string | null;
    sendingEnabled?: boolean | null;
    connectionStatus?: string | null;
  } | null;
  /** Job-locked approved sender — if set, must match registry and live Gmail */
  approvedSenderGmail?: string | null;
  rfq: GuardEntity & {
    isRealSource?: boolean | null;
  };
  supplier: GuardEntity & {
    email?: string | null;
    emailVerified?: boolean | null;
    suppressionReason?: string | null;
  };
  globalOutboundPaused: boolean;
  outboundMode: "DISABLED" | "CERTIFICATION" | "AUTONOMOUS";
  isCertificationBatch?: boolean;
  founderApprovedCertification?: boolean;
  workflowContext?: "SUPPLIER_SOURCING" | "GOVERNMENT_BID_SUBMIT";
};

export type GuardResult = {
  allowed: boolean;
  blockers: string[];
};

export function isOperationalEntity(entity: GuardEntity): boolean {
  if (entity.isDemo) return false;
  if (entity.dataMode === "TEST") return false;
  return true;
}

export function assertDemoCannotSend(company: GuardEntity): GuardResult {
  if (company.isDemo || company.dataMode === "TEST") {
    return {
      allowed: false,
      blockers: ["DEMO/TEST company cannot send external email"],
    };
  }
  return { allowed: true, blockers: [] };
}

export function assertCompanyGmailMapping(input: {
  companyId: string;
  gmailCompanyId?: string | null;
}): GuardResult {
  if (!input.gmailCompanyId) {
    return {
      allowed: false,
      blockers: ["Gmail account has no company mapping — block send"],
    };
  }
  if (input.gmailCompanyId !== input.companyId) {
    return {
      allowed: false,
      blockers: ["Wrong-company Gmail sender blocked"],
    };
  }
  return { allowed: true, blockers: [] };
}

export function assertGovernmentSubmissionFirewall(
  workflowContext: OutboundGuardInput["workflowContext"],
): GuardResult {
  if (workflowContext === "GOVERNMENT_BID_SUBMIT") {
    return {
      allowed: false,
      blockers: [
        "GOVERNMENT_BID_SUBMIT blocked — Founder approval required (separate from supplier sourcing)",
      ],
    };
  }
  return { allowed: true, blockers: [] };
}

export function evaluateOutboundGuards(input: OutboundGuardInput): GuardResult {
  const blockers: string[] = [];

  if (input.workflowContext === "GOVERNMENT_BID_SUBMIT") {
    blockers.push(
      "Government bid submission firewall — autonomous send prohibited",
    );
  }

  if (input.globalOutboundPaused) {
    blockers.push("Global outbound kill switch is PAUSED");
  }

  if (input.outboundMode === "DISABLED") {
    blockers.push("Outbound mode DISABLED");
  }

  if (input.outboundMode === "CERTIFICATION") {
    if (!input.isCertificationBatch) {
      blockers.push("Certification mode — only certification batch may send");
    }
    if (!input.founderApprovedCertification) {
      blockers.push("Certification batch requires explicit Founder approval");
    }
  }

  if (!isOperationalEntity(input.company)) {
    blockers.push("DEMO/TEST company cannot participate in operational outbound");
  }
  if (!isOperationalEntity(input.rfq) || input.rfq.isDemo) {
    blockers.push("DEMO/TEST RFQ cannot trigger real supplier email");
  }
  if (input.rfq.isRealSource === false) {
    blockers.push("RFQ is not a real source opportunity");
  }
  if (!input.company.outboundSourcingEnabled) {
    blockers.push("Company outbound sourcing DISABLED");
  }

  const signatory = assertApprovedSignatory({
    authorisedSourcingSignatoryName:
      input.company.authorisedSourcingSignatoryName,
    authorisedSourcingSignatoryConfirmedAt:
      input.company.authorisedSourcingSignatoryConfirmedAt,
  });
  if (!signatory.ok) {
    blockers.push(`${signatory.code}: ${signatory.blockers.join("; ")}`);
  }

  const mailbox = assertMailboxMatchesCompany({
    legalName: input.company.legalName,
    tradingName: input.company.tradingName,
    registrationNumber: input.company.registrationNumber,
    candidateGmail:
      input.approvedSenderGmail ??
      input.gmail?.emailAddress ??
      input.company.approvedSourcingMailbox,
  });
  if (!mailbox.ok) {
    blockers.push(`${mailbox.code}: ${mailbox.blockers.join("; ")}`);
  }

  if (!input.gmail) {
    blockers.push("No Gmail account selected");
  } else {
    if (input.gmail.connectionStatus !== "CONNECTED") {
      blockers.push("Gmail not CONNECTED");
    }
    if (!input.gmail.sendingEnabled) {
      blockers.push("Gmail sending DISABLED");
    }
    const map = assertCompanyGmailMapping({
      companyId: input.company.id,
      gmailCompanyId: input.gmail.companyId,
    });
    blockers.push(...map.blockers);

    // Live authenticated identity must equal registry-approved mailbox — no fallback.
    if (mailbox.ok && input.gmail.emailAddress) {
      const live = assertMailboxMatchesCompany({
        legalName: input.company.legalName,
        tradingName: input.company.tradingName,
        registrationNumber: input.company.registrationNumber,
        candidateGmail: input.gmail.emailAddress,
      });
      if (!live.ok) {
        blockers.push(`${live.code}: ${live.blockers.join("; ")}`);
      }
    }

    if (
      input.approvedSenderGmail &&
      input.gmail.emailAddress &&
      input.approvedSenderGmail.toLowerCase() !==
        input.gmail.emailAddress.toLowerCase()
    ) {
      blockers.push(
        "BLOCKED_MAILBOX_COMPANY_MISMATCH: job-locked sender ≠ authenticated Gmail — no substitution allowed",
      );
    }
  }

  if (!isOperationalEntity(input.supplier) || input.supplier.isDemo) {
    blockers.push("DEMO/TEST supplier cannot receive real outbound");
  }
  if (!input.supplier.email) {
    blockers.push("Supplier has no email address");
  }
  if (!input.supplier.emailVerified) {
    blockers.push("Supplier email not verified — never invent addresses");
  }
  if (input.supplier.suppressionReason) {
    blockers.push(`Supplier suppressed: ${input.supplier.suppressionReason}`);
  }

  return { allowed: blockers.length === 0, blockers };
}

export function isValidPublishedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) return false;
  if (trimmed.endsWith(".invalid")) return false;
  if (trimmed.endsWith(".local")) return false;
  if (trimmed.includes("example.com")) return false;
  if (trimmed.includes("demo.")) return false;
  // Reject obviously invented patterns without treating as verification.
  if (/^(info|sales|quotes)@example\./i.test(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}
