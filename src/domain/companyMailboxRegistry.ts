/**
 * Authoritative company → approved Gmail mailbox registry.
 * No fallback. No personal/admin mailbox substitution.
 */

export const FORBIDDEN_SOURCING_MAILBOXES = [
  "smartprocure.ai@gmail.com",
  "makhubela.ct@gmail.com",
] as const;

export type CompanyMailboxEntry = {
  /** Canonical trading / display name */
  companyKey: string;
  aliases: string[];
  approvedGmail: string;
  /** Optional registration number for disambiguation */
  registrationNumber?: string;
};

/**
 * Explicit Founder-approved company mailbox mappings.
 * Calvin's personal Gmail and SmartProcure are intentionally absent.
 */
export const COMPANY_MAILBOX_REGISTRY: readonly CompanyMailboxEntry[] = [
  {
    companyKey: "Tosaca",
    aliases: ["tosaca", "tosaca (pty) ltd"],
    approvedGmail: "tosacacsd@gmail.com",
  },
  {
    companyKey: "Chapter28 Productions",
    aliases: ["chapter28", "chapter28 productions", "chapter 28 productions"],
    approvedGmail: "chapter28csd@gmail.com",
  },
  {
    companyKey: "Orison Services",
    aliases: ["orison services", "orison services (pty) ltd"],
    approvedGmail: "orisoncsd@gmail.com",
    registrationNumber: "2020/002530/07",
  },
  {
    companyKey: "Khensi M Group",
    aliases: ["khensi m group", "kmg", "khensi m group (pty) ltd"],
    approvedGmail: "kmgcsd@gmail.com",
  },
  {
    companyKey: "Orison Solution",
    aliases: ["orison solution", "orison solutions"],
    approvedGmail: "orisonsolution@gmail.com",
  },
  {
    companyKey: "Orison Chemicals",
    aliases: ["orison chemicals", "orison chemicals (pty) ltd"],
    approvedGmail: "orisonchemcsd@gmail.com",
    registrationNumber: "2014/277853/07",
  },
  {
    companyKey: "Mogwena Industries",
    aliases: ["mogwena industries", "mogwena"],
    approvedGmail: "mogwena.industries@gmail.com",
  },
  {
    companyKey: "Matla a Leruo",
    aliases: ["matla a leruo", "matlaaleruo"],
    approvedGmail: "matlaaleruocsd@gmail.com",
  },
] as const;

export type MailboxResolutionCode =
  | "OK"
  | "BLOCKED_NO_MAILBOX_MAPPING"
  | "BLOCKED_AMBIGUOUS_MAILBOX_MAPPING"
  | "BLOCKED_MAILBOX_COMPANY_MISMATCH"
  | "BLOCKED_FORBIDDEN_MAILBOX"
  | "BLOCKED_NO_APPROVED_SIGNATORY";

export type MailboxResolution =
  | {
      ok: true;
      code: "OK";
      companyKey: string;
      approvedGmail: string;
    }
  | {
      ok: false;
      code: Exclude<MailboxResolutionCode, "OK">;
      blockers: string[];
      approvedGmail?: string;
      companyKey?: string;
    };

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isForbiddenSourcingMailbox(email: string): boolean {
  const e = normEmail(email);
  return FORBIDDEN_SOURCING_MAILBOXES.some((f) => f === e);
}

export function findRegistryEntriesForCompany(input: {
  legalName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
}): CompanyMailboxEntry[] {
  const names = [input.legalName, input.tradingName]
    .filter(Boolean)
    .map((n) => norm(n!));
  const reg = input.registrationNumber?.trim();

  return COMPANY_MAILBOX_REGISTRY.filter((entry) => {
    if (reg && entry.registrationNumber && entry.registrationNumber === reg) {
      return true;
    }
    const keys = [norm(entry.companyKey), ...entry.aliases.map(norm)];
    return names.some((n) => keys.includes(n));
  });
}

/**
 * Resolve exactly one approved mailbox for a bidding company.
 * Never falls back to an authenticated-but-unmapped account.
 */
export function resolveApprovedMailbox(input: {
  legalName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
}): MailboxResolution {
  const matches = findRegistryEntriesForCompany(input);
  if (matches.length === 0) {
    return {
      ok: false,
      code: "BLOCKED_NO_MAILBOX_MAPPING",
      blockers: [
        "No approved company→mailbox mapping for this bidding company",
      ],
    };
  }
  const uniqueMails = [
    ...new Set(matches.map((m) => normEmail(m.approvedGmail))),
  ];
  if (uniqueMails.length > 1 || matches.length > 1 && uniqueMails.length !== 1) {
    // Multiple registry hits with different emails = ambiguous
    if (uniqueMails.length > 1) {
      return {
        ok: false,
        code: "BLOCKED_AMBIGUOUS_MAILBOX_MAPPING",
        blockers: [
          `Multiple approved mailboxes matched: ${uniqueMails.join(", ")}`,
        ],
      };
    }
  }
  // Prefer single unique email even if alias duplicates match
  if (uniqueMails.length !== 1) {
    return {
      ok: false,
      code: "BLOCKED_AMBIGUOUS_MAILBOX_MAPPING",
      blockers: ["Ambiguous company→mailbox mapping"],
    };
  }

  const approvedGmail = uniqueMails[0]!;
  if (isForbiddenSourcingMailbox(approvedGmail)) {
    return {
      ok: false,
      code: "BLOCKED_FORBIDDEN_MAILBOX",
      blockers: [`Mailbox is forbidden for sourcing: ${approvedGmail}`],
      approvedGmail,
    };
  }

  const entry = matches[0]!;
  return {
    ok: true,
    code: "OK",
    companyKey: entry.companyKey,
    approvedGmail,
  };
}

/**
 * Guard: a candidate Gmail identity may only send for the company if it
 * exactly matches the registry-approved mailbox. Availability of any other
 * authenticated account is irrelevant and never a fallback.
 */
export function assertMailboxMatchesCompany(input: {
  legalName?: string | null;
  tradingName?: string | null;
  registrationNumber?: string | null;
  candidateGmail: string | null | undefined;
}): MailboxResolution {
  const resolved = resolveApprovedMailbox(input);
  if (!resolved.ok) return resolved;

  if (!input.candidateGmail) {
    return {
      ok: false,
      code: "BLOCKED_MAILBOX_COMPANY_MISMATCH",
      blockers: [
        "No Gmail identity supplied — cannot fall back to another account",
      ],
      approvedGmail: resolved.approvedGmail,
      companyKey: resolved.companyKey,
    };
  }

  const candidate = normEmail(input.candidateGmail);
  if (isForbiddenSourcingMailbox(candidate)) {
    return {
      ok: false,
      code: "BLOCKED_FORBIDDEN_MAILBOX",
      blockers: [
        `Forbidden sourcing mailbox refused: ${candidate}`,
      ],
      approvedGmail: resolved.approvedGmail,
      companyKey: resolved.companyKey,
    };
  }

  if (candidate !== resolved.approvedGmail) {
    return {
      ok: false,
      code: "BLOCKED_MAILBOX_COMPANY_MISMATCH",
      blockers: [
        `Resolved Gmail ${candidate} does not match approved mailbox ${resolved.approvedGmail} for ${resolved.companyKey}`,
      ],
      approvedGmail: resolved.approvedGmail,
      companyKey: resolved.companyKey,
    };
  }

  return resolved;
}

export function assertApprovedSignatory(input: {
  authorisedSourcingSignatoryName?: string | null;
  authorisedSourcingSignatoryConfirmedAt?: Date | null;
}):
  | { ok: true; signatoryName: string }
  | { ok: false; code: "BLOCKED_NO_APPROVED_SIGNATORY"; blockers: string[] } {
  if (
    !input.authorisedSourcingSignatoryName?.trim() ||
    !input.authorisedSourcingSignatoryConfirmedAt
  ) {
    return {
      ok: false,
      code: "BLOCKED_NO_APPROVED_SIGNATORY",
      blockers: [
        "No explicitly approved company sourcing signatory — do not infer from CSD, Gmail profile, or mailbox username",
      ],
    };
  }
  return {
    ok: true,
    signatoryName: input.authorisedSourcingSignatoryName.trim(),
  };
}
