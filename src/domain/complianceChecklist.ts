/**
 * Build RFQ compliance checklist from extracted requirements + company vault.
 * Never invent mandatory items without an evidence source.
 */

import type { ComplianceItemState } from "./compliance";

export type ChecklistSourceRequirement = {
  requirementType: string;
  description: string;
  isMandatory: boolean;
  evidenceSource?: string | null;
};

export type CompanyDocCoverage = {
  documentType: string;
  verificationState: string;
  expiryDate?: Date | null;
  title?: string | null;
};

export type ChecklistDraftItem = {
  itemKey: string;
  label: string;
  isMandatory: boolean;
  state: ComplianceItemState;
  notes?: string;
  evidenceSource: string;
};

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
}

function companyDocState(
  docs: CompanyDocCoverage[],
  types: string[],
  now = new Date(),
): { state: ComplianceItemState; notes: string } {
  const match = docs.find((d) =>
    types.some((t) => d.documentType.toUpperCase().includes(t.toUpperCase())),
  );
  if (!match) return { state: "MISSING", notes: "Not found in company vault" };
  if (match.expiryDate && match.expiryDate.getTime() < now.getTime()) {
    return {
      state: "EXPIRED",
      notes: `${match.title ?? match.documentType} expired`,
    };
  }
  if (
    match.verificationState === "AVAILABLE" ||
    match.verificationState === "VERIFIED" ||
    match.verificationState === "COMPLETED"
  ) {
    return {
      state: match.verificationState === "VERIFIED" ? "VERIFIED" : "AVAILABLE",
      notes: match.title ?? match.documentType,
    };
  }
  return {
    state: (match.verificationState as ComplianceItemState) || "AVAILABLE",
    notes: match.title ?? match.documentType,
  };
}

/**
 * Standard submission pack items commonly required for SA public RFQs,
 * only included when RFQ requirements or explicit flags indicate them.
 */
export function buildComplianceChecklist(input: {
  rfqInternalId: string;
  requirements: ChecklistSourceRequirement[];
  companyDocs: CompanyDocCoverage[];
  hasPricingScenario: boolean;
  hasLineItems: boolean;
  briefingCompulsory: boolean;
  briefingCompulsoryKnown: boolean;
  briefingAttended?: boolean;
  now?: Date;
}): ChecklistDraftItem[] {
  const now = input.now ?? new Date();
  const items: ChecklistDraftItem[] = [];
  const seen = new Set<string>();

  const push = (item: ChecklistDraftItem) => {
    if (seen.has(item.itemKey)) return;
    seen.add(item.itemKey);
    items.push(item);
  };

  // Always: priced schedule from BOQ
  push({
    itemKey: "pricing_schedule",
    label: "Pricing schedule / quotation completed",
    isMandatory: true,
    state: input.hasPricingScenario && input.hasLineItems ? "AVAILABLE" : "MISSING",
    notes: input.hasPricingScenario
      ? "Pricing scenario exists — Founder must still review"
      : "No pricing scenario",
    evidenceSource: `${input.rfqInternalId} BOQ + pricing engine`,
  });

  // Company vault coverage for common credentials
  const csd = companyDocState(input.companyDocs, ["CSD"], now);
  push({
    itemKey: "csd",
    label: "CSD registration report",
    isMandatory: true,
    state: csd.state,
    notes: csd.notes,
    evidenceSource: "Company document vault / CSD",
  });

  const tax = companyDocState(input.companyDocs, ["TAX", "TAX_CLEARANCE"], now);
  push({
    itemKey: "tax",
    label: "Tax compliance status",
    isMandatory: true,
    state: tax.state,
    notes: tax.notes,
    evidenceSource: "Company document vault / Tax",
  });

  const bee = companyDocState(input.companyDocs, ["BBBEE", "BEE", "B-BBEE"], now);
  push({
    itemKey: "bbbee",
    label: "B-BBEE affidavit / certificate",
    isMandatory: true,
    state: bee.state,
    notes: bee.notes,
    evidenceSource: "Company document vault / B-BBEE",
  });

  const cipc = companyDocState(input.companyDocs, ["CIPC", "COR"], now);
  push({
    itemKey: "cipc",
    label: "CIPC / company registration",
    isMandatory: true,
    state: cipc.state,
    notes: cipc.notes,
    evidenceSource: "Company document vault / CIPC",
  });

  if (input.briefingCompulsoryKnown && input.briefingCompulsory) {
    push({
      itemKey: "compulsory_briefing",
      label: "Compulsory briefing attendance proof",
      isMandatory: true,
      state: input.briefingAttended ? "AVAILABLE" : "MISSING",
      notes: input.briefingAttended
        ? "Attendance evidence recorded"
        : "Briefing compulsory — proof missing",
      evidenceSource: "RFQ briefing requirement",
    });
  } else if (!input.briefingCompulsoryKnown) {
    push({
      itemKey: "compulsory_briefing",
      label: "Briefing requirement confirmation",
      isMandatory: true,
      state: "MISSING",
      notes: "UNKNOWN whether briefing is compulsory — verify in documents",
      evidenceSource: "RFQ briefingCompulsoryKnown=false",
    });
  } else {
    push({
      itemKey: "compulsory_briefing",
      label: "Compulsory briefing",
      isMandatory: false,
      state: "NOT_REQUIRED",
      notes: "Not indicated as compulsory",
      evidenceSource: "RFQ briefingCompulsory=false",
    });
  }

  // From extracted RFQ requirements — preserve wording/source
  for (const req of input.requirements) {
    const key = `req_${slug(req.requirementType || req.description)}`;
    const type = req.requirementType.toUpperCase();
    let state: ComplianceItemState = req.isMandatory ? "MISSING" : "NOT_REQUIRED";
    let notes = "Awaiting pack assembly / signature";

    if (/CSD/.test(type) || /CSD/i.test(req.description)) {
      state = csd.state;
      notes = csd.notes;
    } else if (/TAX/.test(type) || /tax/i.test(req.description)) {
      state = tax.state;
      notes = tax.notes;
    } else if (/BEE|BBBEE|B-BBEE/i.test(type + req.description)) {
      state = bee.state;
      notes = bee.notes;
    } else if (/MBD|SBD|DECLARATION|FORM/i.test(type + req.description)) {
      state = "MISSING";
      notes = "Form must be completed and signed for submission pack";
    } else if (/DATASHEET|OEM|BRAND|SPEC/i.test(type + req.description)) {
      state = "REVIEW_REQUIRED" as never;
      // ComplianceItemState doesn't have REVIEW_REQUIRED — use NEEDS_SIGNATURE or MISSING
      state = "MISSING";
      notes = "Technical evidence / datasheets still required before submit";
    }

    push({
      itemKey: key,
      label: req.description.slice(0, 120),
      isMandatory: req.isMandatory,
      state: req.isMandatory ? state : state === "MISSING" ? "NOT_REQUIRED" : state,
      notes,
      evidenceSource:
        req.evidenceSource ??
        `Extracted RFQ requirement (${req.requirementType})`,
    });
  }

  push({
    itemKey: "founder_review",
    label: "Founder commercial & compliance review",
    isMandatory: true,
    state: "MISSING",
    notes: "Required before READY_TO_SUBMIT",
    evidenceSource: "Operating policy — Founder approval mandatory",
  });

  push({
    itemKey: "signatures",
    label: "Authorised signatures / initials on submission forms",
    isMandatory: true,
    state: "MISSING",
    notes: "Not assembled yet — no autonomous submission",
    evidenceSource: "Submission pack policy",
  });

  return items;
}
