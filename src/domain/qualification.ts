import type { OpportunityClass } from "./classification";
import { evaluateDeadline } from "./deadlines";

export type FactorLevel = "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN" | "CLEAR" | "INCOMPLETE" | "AMBIGUOUS" | "YES" | "NO" | "POTENTIALLY" | "MISSING" | "ATTRACTIVE" | "UNCLEAR" | "POOR" | "LIKELY" | "SPECIALIST";

export type QualificationFactors = {
  classification: OpportunityClass;
  classificationConfidence: number;
  closingAt: Date;
  closingTimeKnown: boolean;
  timezone?: string;
  now?: Date;
  submissionMethod: "EMAIL" | "PORTAL" | "ETENDER" | "PHYSICAL" | "OTHER" | "UNKNOWN";
  briefingCompulsory: boolean;
  briefingCompulsoryKnown: boolean;
  briefingDate?: Date | null;
  briefingAttendanceEvidence?: boolean;
  specificationClarity: "CLEAR" | "INCOMPLETE" | "AMBIGUOUS" | "UNKNOWN";
  supplierFeasibility: "LIKELY" | "SPECIALIST" | "UNKNOWN";
  companyEligibility: "POTENTIALLY" | "MISSING" | "UNKNOWN";
  capitalRequirement: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  deliveryComplexity: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  commercialPotential: "ATTRACTIVE" | "UNCLEAR" | "POOR" | "UNKNOWN";
  /** Hard disqualifiers detected from text/requirements. */
  hardBlockers?: HardBlocker[];
  /** Manual gate override (does not erase underlying reasons). */
  overrideGate?: "GREEN" | "AMBER" | "RED" | null;
};

export type HardBlocker =
  | "DEADLINE_PASSED"
  | "BRIEFING_MISSED"
  | "MANDATORY_LICENCE"
  | "MANDATORY_GRADING"
  | "MANDATORY_CERTIFICATION"
  | "DELIVERY_IMPOSSIBLE"
  | "SUBMISSION_UNAVAILABLE"
  | "OEM_AUTHORISATION_REQUIRED";

export type QualificationResult = {
  gate: "GREEN" | "AMBER" | "RED";
  reasons: string[];
  hardNoBid: boolean;
  hardNoBidCategory?:
    | "DEADLINE"
    | "BRIEFING_MISSED"
    | "LICENCE"
    | "GRADING"
    | "COMPLIANCE"
    | "DELIVERY"
    | "OTHER";
  factors: Record<string, string>;
  overridden: boolean;
};

const HARD_NO_BID_MAP: Record<
  HardBlocker,
  NonNullable<QualificationResult["hardNoBidCategory"]>
> = {
  DEADLINE_PASSED: "DEADLINE",
  BRIEFING_MISSED: "BRIEFING_MISSED",
  MANDATORY_LICENCE: "LICENCE",
  MANDATORY_GRADING: "GRADING",
  MANDATORY_CERTIFICATION: "COMPLIANCE",
  DELIVERY_IMPOSSIBLE: "DELIVERY",
  SUBMISSION_UNAVAILABLE: "OTHER",
  OEM_AUTHORISATION_REQUIRED: "LICENCE",
};

/**
 * Transparent qualification. Colour alone is never the decision —
 * reasons and factors are always returned.
 */
export function qualifyOpportunity(
  input: QualificationFactors,
): QualificationResult {
  const now = input.now ?? new Date();
  const deadline = evaluateDeadline(
    input.closingAt,
    now,
    input.timezone ?? "Africa/Johannesburg",
  );
  const reasons: string[] = [];
  const factors: Record<string, string> = {};
  const blockers = [...(input.hardBlockers ?? [])];

  factors.classification = `${input.classification} (confidence ${(input.classificationConfidence * 100).toFixed(0)}%)`;
  factors.deadline = deadline.isClosed
    ? "CLOSED"
    : `${deadline.label} remaining${input.closingTimeKnown ? "" : " · closing time UNKNOWN"}`;
  factors.submission = input.submissionMethod;
  factors.briefing = !input.briefingCompulsoryKnown
    ? "Unknown whether compulsory"
    : input.briefingCompulsory
      ? `Compulsory${input.briefingDate ? ` on ${input.briefingDate.toISOString()}` : ""}`
      : "Not compulsory / not indicated";
  factors.specifications = input.specificationClarity;
  factors.supplierFeasibility = input.supplierFeasibility;
  factors.companyEligibility = input.companyEligibility;
  factors.capital = input.capitalRequirement;
  factors.delivery = input.deliveryComplexity;
  factors.commercial = input.commercialPotential;

  if (deadline.isClosed) {
    blockers.push("DEADLINE_PASSED");
    reasons.push("Closing deadline has passed");
  } else if (deadline.hoursRemaining < 48) {
    reasons.push("Less than 48 hours remaining — operational risk");
  } else {
    reasons.push(`${deadline.label} remaining until close`);
  }

  if (!input.closingTimeKnown) {
    reasons.push("Closing time UNKNOWN — verify exact cut-off from source documents");
  }

  if (
    input.briefingCompulsoryKnown &&
    input.briefingCompulsory &&
    input.briefingDate &&
    input.briefingDate.getTime() < now.getTime() &&
    !input.briefingAttendanceEvidence
  ) {
    blockers.push("BRIEFING_MISSED");
    reasons.push("Compulsory briefing already occurred — no attendance evidence");
  } else if (input.briefingCompulsoryKnown && input.briefingCompulsory) {
    reasons.push("Compulsory briefing required — verify attendance");
  } else if (input.briefingCompulsoryKnown && !input.briefingCompulsory) {
    reasons.push("No compulsory briefing indicated");
  } else {
    reasons.push("Briefing compulsory status unknown — check documents");
  }

  if (input.classification === "SUPPLY_AND_DELIVER") {
    reasons.push("Supply-and-deliver classification");
  } else if (input.classification === "CONSTRUCTION") {
    reasons.push("Construction classification — often requires grading we may lack");
  } else {
    reasons.push(`Classification: ${input.classification}`);
  }

  if (input.classificationConfidence < 0.5) {
    reasons.push("Classification confidence low — treat carefully");
  }

  switch (input.specificationClarity) {
    case "CLEAR":
      reasons.push("Specifications appear clear");
      break;
    case "INCOMPLETE":
      reasons.push("Specifications incomplete");
      break;
    case "AMBIGUOUS":
      reasons.push("Specifications ambiguous");
      break;
    default:
      reasons.push("Specification clarity unknown — review documents");
  }

  if (input.supplierFeasibility === "LIKELY") {
    reasons.push("Supplier sourcing likely straightforward");
  } else if (input.supplierFeasibility === "SPECIALIST") {
    reasons.push("Specialist supplier likely required");
  } else {
    reasons.push("Supplier feasibility unknown");
  }

  if (input.submissionMethod === "UNKNOWN") {
    reasons.push("Submission mechanism unknown");
  } else if (input.submissionMethod === "EMAIL") {
    reasons.push("Submission by email");
  } else {
    reasons.push(`Submission via ${input.submissionMethod}`);
  }

  if (input.companyEligibility === "MISSING") {
    reasons.push("Company missing mandatory eligibility requirements");
  }

  if (input.deliveryComplexity === "HIGH") {
    reasons.push("High delivery complexity");
  }

  if (input.capitalRequirement === "HIGH") {
    reasons.push("High capital intensity");
  }

  if (input.commercialPotential === "POOR") {
    reasons.push("Commercial potential assessed as poor");
  } else if (input.commercialPotential === "ATTRACTIVE") {
    reasons.push("Commercial potential potentially attractive");
  }

  const uniqueBlockers = [...new Set(blockers)];
  const hardDisqualifiers = uniqueBlockers.filter((b) =>
    (
      [
        "DEADLINE_PASSED",
        "BRIEFING_MISSED",
        "MANDATORY_LICENCE",
        "MANDATORY_GRADING",
        "MANDATORY_CERTIFICATION",
        "DELIVERY_IMPOSSIBLE",
        "SUBMISSION_UNAVAILABLE",
      ] as HardBlocker[]
    ).includes(b),
  );
  const advisoryBlockers = uniqueBlockers.filter(
    (b) => !hardDisqualifiers.includes(b),
  );

  let gate: "GREEN" | "AMBER" | "RED" = "GREEN";

  if (hardDisqualifiers.length > 0) {
    gate = "RED";
  } else {
    const amberTriggers = [
      deadline.hoursRemaining < 72 && !deadline.isClosed,
      !input.closingTimeKnown,
      input.classificationConfidence < 0.55,
      input.specificationClarity === "INCOMPLETE" ||
        input.specificationClarity === "AMBIGUOUS" ||
        input.specificationClarity === "UNKNOWN",
      input.supplierFeasibility !== "LIKELY",
      input.companyEligibility === "UNKNOWN" ||
        input.companyEligibility === "MISSING",
      input.capitalRequirement === "HIGH" ||
        input.capitalRequirement === "UNKNOWN",
      input.deliveryComplexity === "HIGH",
      input.submissionMethod === "UNKNOWN" ||
        input.submissionMethod === "PHYSICAL",
      input.classification !== "SUPPLY_AND_DELIVER",
      input.commercialPotential === "POOR" ||
        input.commercialPotential === "UNCLEAR",
      input.briefingCompulsoryKnown && input.briefingCompulsory,
      advisoryBlockers.length > 0,
    ];
    if (amberTriggers.some(Boolean)) {
      gate = "AMBER";
    }
  }

  const hardNoBid = hardDisqualifiers.length > 0;

  let hardNoBidCategory: QualificationResult["hardNoBidCategory"];
  if (hardNoBid && hardDisqualifiers[0]) {
    hardNoBidCategory = HARD_NO_BID_MAP[hardDisqualifiers[0]];
  }

  if (advisoryBlockers.includes("OEM_AUTHORISATION_REQUIRED")) {
    reasons.push(
      "OEM authorisation required — confirm obtainability before proceed",
    );
  }

  const overridden = Boolean(input.overrideGate && input.overrideGate !== gate);
  if (input.overrideGate) {
    reasons.push(
      `Manual qualification override: ${input.overrideGate} (system was ${gate})`,
    );
    gate = input.overrideGate;
  }

  return {
    gate,
    reasons,
    hardNoBid,
    hardNoBidCategory,
    factors,
    overridden,
  };
}

/** Detect hard blockers from free-text title/description/requirements. */
export function detectHardBlockersFromText(text: string): HardBlocker[] {
  const t = text.toLowerCase();
  const out: HardBlocker[] = [];
  if (/\b(cidb|grading\s*[1-9]|gb\s*[1-9])\b/.test(t)) {
    out.push("MANDATORY_GRADING");
  }
  if (/\b(licence|license)\b/.test(t) && /\b(mandatory|must\s+possess|must\s+hold)\b/.test(t)) {
    out.push("MANDATORY_LICENCE");
  }
  if (/\b(oem|authorised\s+dealer|authorized\s+dealer|manufacturer.?s\s+authori[sz]ed)\b/.test(t)) {
    out.push("OEM_AUTHORISATION_REQUIRED");
  }
  if (/\b(impossible|cannot\s+be\s+delivered|delivery\s+within\s+24\s*hours)\b/.test(t)) {
    out.push("DELIVERY_IMPOSSIBLE");
  }
  return out;
}

export function inferSpecificationClarity(
  description?: string | null,
): "CLEAR" | "INCOMPLETE" | "AMBIGUOUS" | "UNKNOWN" {
  if (!description || description.trim().length < 40) return "INCOMPLETE";
  if (description.trim().length > 120) return "CLEAR";
  return "UNKNOWN";
}

export function inferSupplierFeasibility(
  classification: OpportunityClass,
  text: string,
): "LIKELY" | "SPECIALIST" | "UNKNOWN" {
  if (/\b(oem|authorised\s+dealer|specialist|vaccine|pharmaceutical|medical)\b/i.test(text)) {
    return "SPECIALIST";
  }
  if (classification === "SUPPLY_AND_DELIVER") return "LIKELY";
  if (classification === "CONSTRUCTION" || classification === "CONSULTING") {
    return "SPECIALIST";
  }
  return "UNKNOWN";
}
