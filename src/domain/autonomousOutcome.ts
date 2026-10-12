/**
 * Outcome classification + commercial guardrails for Autonomous RFQ Engine V1.
 * Throughput > forced completion: escalate when evidence is weak.
 */

import type { AutonomousOutcome } from "./autonomousStates";
import {
  meetsAutoQuotedEvidenceFloor,
  isAiEstimate,
  isStaleEvidence,
  type PricingEvidenceLevel,
} from "./pricingEvidenceHierarchy";
import { mayAutoSelect, type SpecMatchVerdict } from "./specificationMatching";

export type GuardrailLine = {
  lineNumber: number;
  unresolved: boolean;
  matchVerdict: SpecMatchVerdict | null;
  evidenceLevel: PricingEvidenceLevel | null;
  evidenceAgeHours: number | null;
  flags: string[];
};

export type GuardrailInput = {
  eligibility: "ELIGIBLE" | "ELIGIBLE_WITH_WARNING" | "NOT_ELIGIBLE" | "UNRESOLVED";
  compulsoryBriefingMissed: boolean;
  closingDeadlinePassed: boolean;
  mandatoryRequirementUnsatisfied: boolean;
  tenderValueExceedsThreshold: boolean;
  lines: GuardrailLine[];
  /** Overall confidence 0–1 after pricing. */
  confidence: number;
  /** Auto-quoted confidence floor (default 0.7). */
  autoQuotedConfidenceFloor?: number;
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
    reasons.push("Mandatory requirement cannot be satisfied");
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons,
    };
  }

  if (input.eligibility === "UNRESOLVED") {
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons: ["Eligibility unresolved"],
    };
  }

  if (input.tenderValueExceedsThreshold) {
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons: ["Tender value/risk exceeds configured threshold"],
    };
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
    if (
      line.evidenceLevel &&
      isStaleEvidence(line.evidenceLevel, line.evidenceAgeHours)
    ) {
      reasons.push(`Line ${line.lineNumber}: stale pricing evidence`);
    }
    if (line.flags.includes("UNKNOWN_DELIVERY_COST")) {
      reasons.push(`Line ${line.lineNumber}: delivery cost could materially change economics`);
    }
    if (line.flags.includes("PACK_SIZE_AMBIGUITY")) {
      reasons.push(`Line ${line.lineNumber}: pack size ambiguous`);
    }
    if (line.matchVerdict && !mayAutoSelect(line.matchVerdict) && !line.unresolved) {
      reasons.push(
        `Line ${line.lineNumber}: match ${line.matchVerdict} not auto-selectable`,
      );
    }
  }

  const floor = input.autoQuotedConfidenceFloor ?? 0.7;
  if (input.confidence < floor) {
    reasons.push(
      `Confidence ${input.confidence.toFixed(2)} below AUTO_QUOTED floor ${floor}`,
    );
  }

  if (reasons.length > 0) {
    // If majority unresolved → UNPRICEABLE, else REVIEW_REQUIRED
    if (unresolved.length > input.lines.length / 2) {
      return {
        outcome: "UNPRICEABLE",
        state: "UNPRICEABLE",
        reasons,
      };
    }
    return {
      outcome: "REVIEW_REQUIRED",
      state: "REVIEW_REQUIRED",
      reasons,
    };
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
      "Requirements understood, products matched, defensible pricing, draft quotation generated",
    ],
  };
}
