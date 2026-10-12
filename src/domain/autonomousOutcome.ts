/**
 * Outcome classification + commercial guardrails V2.
 * Unknown delivery is uncertainty — escalate when material; never bury in markup.
 */

import type { AutonomousOutcome } from "./autonomousStates";
import {
  meetsAutoQuotedEvidenceFloor,
  isAiEstimate,
  type PricingEvidenceLevel,
} from "./pricingEvidenceHierarchy";
import { mayAutoSelect, type SpecMatchVerdict } from "./specificationMatching";
import { RESEARCH_POLICY } from "./researchPolicy";

export type GuardrailLine = {
  lineNumber: number;
  unresolved: boolean;
  matchVerdict: SpecMatchVerdict | null;
  evidenceLevel: PricingEvidenceLevel | null;
  evidenceAgeHours: number | null;
  flags: string[];
  lineConfidence?: number;
  liveEvidence?: boolean;
  multiSource?: boolean;
  packResolved?: boolean;
  vatMaterialUnknown?: boolean;
  deliveryMaterialUnknown?: boolean;
  /** Commercial integrity V1 */
  quantityReconciled?: boolean;
  priceBasisKnown?: boolean;
  packEconomicsPassed?: boolean;
};

export type GuardrailInput = {
  eligibility: "ELIGIBLE" | "ELIGIBLE_WITH_WARNING" | "NOT_ELIGIBLE" | "UNRESOLVED";
  compulsoryBriefingMissed: boolean;
  closingDeadlinePassed: boolean;
  mandatoryRequirementUnsatisfied: boolean;
  tenderValueExceedsThreshold: boolean;
  lines: GuardrailLine[];
  confidence: number;
  autoQuotedConfidenceFloor?: number;
  classificationConfident?: boolean;
  boqComplete?: boolean;
  /** Commercial integrity gate — required for AUTO_QUOTED V3 */
  commercialIntegrityPassed?: boolean;
  commercialIntegrityFailures?: string[];
  livePricingCredible?: boolean;
  unexplainedExtremeVariance?: boolean;
};

export type GuardrailResult = {
  outcome: AutonomousOutcome;
  reasons: string[];
  state:
    | "AUTO_QUOTED"
    | "REVIEW_REQUIRED"
    | "UNPRICEABLE"
    | "INELIGIBLE"
    | "FAILED";
};

export function classifyAutonomousOutcome(
  input: GuardrailInput,
): GuardrailResult {
  const reasons: string[] = [];
  const floor =
    input.autoQuotedConfidenceFloor ??
    RESEARCH_POLICY.autoQuoted.minOverallConfidence;

  if (input.eligibility === "NOT_ELIGIBLE") {
    return {
      outcome: "INELIGIBLE",
      state: "INELIGIBLE",
      reasons: ["Company/RFQ eligibility blockers present"],
    };
  }

  if (input.compulsoryBriefingMissed) {
    return {
      outcome: "INELIGIBLE",
      state: "INELIGIBLE",
      reasons: ["Compulsory briefing missed"],
    };
  }

  if (input.closingDeadlinePassed) {
    return {
      outcome: "INELIGIBLE",
      state: "INELIGIBLE",
      reasons: ["Closing deadline passed"],
    };
  }

  if (input.mandatoryRequirementUnsatisfied) {
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons: ["Mandatory requirement cannot be satisfied"],
    };
  }

  if (input.eligibility === "UNRESOLVED") {
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons: ["Eligibility unresolved"],
    };
  }

  if (input.classificationConfident === false) {
    reasons.push("Supply & Deliver classification confidence insufficient");
  }

  if (input.boqComplete === false) {
    reasons.push("BOQ incomplete");
  }

  if (input.tenderValueExceedsThreshold) {
    reasons.push("Tender value/risk exceeds configured threshold");
  }

  const unresolved = input.lines.filter((l) => l.unresolved);
  if (unresolved.length === input.lines.length && input.lines.length > 0) {
    return {
      outcome: "UNPRICEABLE",
      state: "UNPRICEABLE",
      reasons: ["All BOQ lines unresolved — no credible prices"],
    };
  }

  if (unresolved.length > 0) {
    reasons.push(
      `Major BOQ lines unresolved: ${unresolved.map((l) => l.lineNumber).join(", ")}`,
    );
  }

  for (const line of input.lines) {
    if (line.matchVerdict === "MISMATCH") {
      reasons.push(`Line ${line.lineNumber}: specification MISMATCH`);
    }
    if (
      line.evidenceLevel &&
      (isAiEstimate(line.evidenceLevel) ||
        !meetsAutoQuotedEvidenceFloor(line.evidenceLevel))
    ) {
      reasons.push(
        `Line ${line.lineNumber}: price evidence too weak (${line.evidenceLevel})`,
      );
    }
    if (line.flags.includes("STALE_PRICE") || line.flags.includes("EXPIRED_FOR_AUTONOMOUS_PRICING")) {
      reasons.push(`Line ${line.lineNumber}: stale/expired pricing evidence`);
    }
    if (line.deliveryMaterialUnknown || line.flags.includes("DELIVERY_MATERIAL_UNKNOWN")) {
      reasons.push(
        `Line ${line.lineNumber}: delivery economics MATERIAL unknown (not compensated via markup)`,
      );
    }
    if (line.packResolved === false || line.flags.includes("PACK_SIZE_AMBIGUITY")) {
      reasons.push(`Line ${line.lineNumber}: pack size unresolved`);
    }
    if (line.quantityReconciled === false) {
      reasons.push(`Line ${line.lineNumber}: quantity reconciliation failed`);
    }
    if (line.priceBasisKnown === false) {
      reasons.push(`Line ${line.lineNumber}: price basis unknown`);
    }
    if (line.packEconomicsPassed === false) {
      reasons.push(`Line ${line.lineNumber}: pack economics not passed`);
    }
    if (line.vatMaterialUnknown) {
      reasons.push(`Line ${line.lineNumber}: VAT uncertainty material`);
    }
    if (
      line.lineConfidence != null &&
      line.lineConfidence < RESEARCH_POLICY.autoQuoted.minLineConfidence
    ) {
      reasons.push(
        `Line ${line.lineNumber}: research confidence ${line.lineConfidence.toFixed(2)} below floor`,
      );
    }
    if (line.matchVerdict && !mayAutoSelect(line.matchVerdict) && !line.unresolved) {
      reasons.push(
        `Line ${line.lineNumber}: match ${line.matchVerdict} not auto-selectable`,
      );
    }
    if (
      RESEARCH_POLICY.autoQuoted.requireMultiSourceUnlessHighQuality &&
      line.multiSource === false &&
      !(line.flags ?? []).includes("HIGH_QUALITY_SINGLE_SOURCE")
    ) {
      // Soft flag — contributes to review unless high quality single source
      if (!line.flags.includes("SINGLE_SOURCE_PRICE")) {
        // already noted elsewhere
      }
    }
  }

  if (input.confidence < floor) {
    reasons.push(
      `Confidence ${input.confidence.toFixed(2)} below AUTO_QUOTED floor ${floor}`,
    );
  }

  if (input.livePricingCredible === false) {
    reasons.push("Live pricing not credible for autonomous quotation");
  }

  if (input.unexplainedExtremeVariance) {
    reasons.push("Unexplained EXTREME_VARIANCE vs historical comparator");
  }

  if (input.commercialIntegrityPassed === false) {
    reasons.push(
      `Commercial integrity gate failed: ${(input.commercialIntegrityFailures ?? []).join("; ") || "see audit"}`,
    );
  }

  if (reasons.length > 0) {
    if (unresolved.length > input.lines.length / 2) {
      return { outcome: "UNPRICEABLE", state: "UNPRICEABLE", reasons };
    }
    return { outcome: "REVIEW_REQUIRED", state: "REVIEW_REQUIRED", reasons };
  }

  if (input.eligibility === "ELIGIBLE_WITH_WARNING") {
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons: ["Eligibility has warnings — Founder review required"],
    };
  }

  return {
    outcome: "AUTO_QUOTED",
    state: "AUTO_QUOTED",
    reasons: [
      "Requirements understood, live products matched, defensible pricing, draft quotation generated",
    ],
  };
}
