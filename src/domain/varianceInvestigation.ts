/**
 * Second-source research cycle for EXTREME price variance.
 * Do not invent explanations.
 */

import type { VarianceResult, VarianceExplanationCode } from "./priceVariancePolicy";
import { classifyPriceVariance } from "./priceVariancePolicy";

export type VarianceInvestigation = {
  trigger: "EXTREME_VARIANCE";
  originalObservation: {
    oldCost: number | null;
    newCost: number;
    band: string;
  };
  additionalSearches: string[];
  additionalCandidateIds: string[];
  explanationCode: VarianceExplanationCode | null;
  explanation: string | null;
  confidence: number;
  resolved: boolean;
  reasoning: string;
};

export type VarianceEvidenceSignal = {
  code: VarianceExplanationCode;
  evidence: string;
  confidence: number;
};

/**
 * Resolve variance from evidence signals gathered during second-source research.
 * Only marks resolved when a signal is strong (≥0.7) — never invents.
 */
export function investigateExtremeVariance(input: {
  variance: VarianceResult;
  signals: VarianceEvidenceSignal[];
  additionalSearches: string[];
  additionalCandidateIds: string[];
}): VarianceInvestigation {
  const base: VarianceInvestigation = {
    trigger: "EXTREME_VARIANCE",
    originalObservation: {
      oldCost: input.variance.oldCost,
      newCost: input.variance.newCost,
      band: input.variance.band,
    },
    additionalSearches: input.additionalSearches,
    additionalCandidateIds: input.additionalCandidateIds,
    explanationCode: null,
    explanation: null,
    confidence: 0,
    resolved: false,
    reasoning: "No strong evidence to explain variance",
  };

  if (input.variance.band !== "EXTREME_VARIANCE") {
    return {
      ...base,
      trigger: "EXTREME_VARIANCE",
      resolved: true,
      confidence: 1,
      reasoning: "Variance not extreme — investigation not required",
    };
  }

  const strong = [...input.signals]
    .filter((s) => s.confidence >= 0.7)
    .sort((a, b) => b.confidence - a.confidence);

  if (strong.length === 0) {
    return {
      ...base,
      reasoning:
        "Second-source cycle completed without strong explanatory evidence — REVIEW_REQUIRED",
    };
  }

  const best = strong[0];
  return {
    ...base,
    explanationCode: best.code,
    explanation: `${best.code}: ${best.evidence}`,
    confidence: best.confidence,
    resolved: true,
    reasoning: `Variance explained by ${best.code} (confidence ${best.confidence.toFixed(2)})`,
  };
}

export function reclassifyVarianceAfterInvestigation(
  variance: VarianceResult,
  investigation: VarianceInvestigation,
): VarianceResult {
  if (!investigation.resolved || !investigation.explanationCode) {
    return { ...variance, blocksAutoQuoted: true };
  }
  return classifyPriceVariance({
    oldCost: variance.oldCost,
    newCost: variance.newCost,
    explanationCode: investigation.explanationCode,
    explanationText: investigation.explanation,
  });
}

/** Suggest second-source search queries — no invented answers. */
export function varianceSecondSourceQueries(input: {
  description: string;
  brand?: string | null;
  suspectedPack?: boolean;
}): string[] {
  const core = input.description.slice(0, 80);
  const brand = input.brand ?? "";
  return [
    [brand, core, "pack of", "South Africa", "price"].filter(Boolean).join(" "),
    [brand, core, "wholesale", "bulk", "South Africa"].filter(Boolean).join(" "),
    [brand, core, "each", "unit price", "South Africa"].filter(Boolean).join(" "),
    [core, "or equivalent", "distributor", "South Africa"].join(" "),
  ].slice(0, 4);
}
