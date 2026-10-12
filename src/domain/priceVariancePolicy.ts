/**
 * Historical / cross-source price variance policy.
 * Historical evidence is a comparator, not truth.
 */

export const VARIANCE_POLICY = {
  normalMax: 0.15,
  moderateMax: 0.3,
  highMax: 0.75,
} as const;

export type VarianceBand =
  | "NORMAL_VARIANCE"
  | "MODERATE_VARIANCE"
  | "HIGH_VARIANCE"
  | "EXTREME_VARIANCE"
  | "NO_COMPARATOR";

export type VarianceResult = {
  band: VarianceBand;
  ratio: number | null;
  percentChange: number | null;
  oldCost: number | null;
  newCost: number;
  blocksAutoQuoted: boolean;
  explanationRequired: boolean;
  explanation: string | null;
  validExplanationCodes: string[];
};

const VALID_EXPLANATIONS = [
  "DIFFERENT_PACK_QUANTITY",
  "OLD_EVIDENCE_STALE",
  "WRONG_HISTORICAL_PRODUCT",
  "MATERIAL_MARKET_MOVEMENT",
  "DIFFERENT_SPECIFICATION",
  "HISTORICAL_CALCULATION_ERROR",
  "UNIT_OF_MEASURE_CORRECTION",
] as const;

export type VarianceExplanationCode = (typeof VALID_EXPLANATIONS)[number];

export function classifyPriceVariance(input: {
  oldCost: number | null | undefined;
  newCost: number;
  explanationCode?: VarianceExplanationCode | null;
  explanationText?: string | null;
}): VarianceResult {
  if (input.oldCost == null || !Number.isFinite(input.oldCost) || input.oldCost <= 0) {
    return {
      band: "NO_COMPARATOR",
      ratio: null,
      percentChange: null,
      oldCost: null,
      newCost: input.newCost,
      blocksAutoQuoted: false,
      explanationRequired: false,
      explanation: null,
      validExplanationCodes: [...VALID_EXPLANATIONS],
    };
  }

  const ratio = input.newCost / input.oldCost;
  const percentChange = (ratio - 1) * 100;
  const absDelta = Math.abs(ratio - 1);

  let band: VarianceBand;
  if (absDelta < VARIANCE_POLICY.normalMax) band = "NORMAL_VARIANCE";
  else if (absDelta < VARIANCE_POLICY.moderateMax) band = "MODERATE_VARIANCE";
  else if (absDelta < VARIANCE_POLICY.highMax) band = "HIGH_VARIANCE";
  else band = "EXTREME_VARIANCE";

  const explained =
    input.explanationCode != null &&
    VALID_EXPLANATIONS.includes(input.explanationCode);

  return {
    band,
    ratio,
    percentChange,
    oldCost: input.oldCost,
    newCost: input.newCost,
    blocksAutoQuoted: band === "EXTREME_VARIANCE" && !explained,
    explanationRequired: band === "EXTREME_VARIANCE",
    explanation: explained
      ? `${input.explanationCode}: ${input.explanationText ?? ""}`.trim()
      : input.explanationText ?? null,
    validExplanationCodes: [...VALID_EXPLANATIONS],
  };
}

export function crossSourcePriceVariance(
  effectiveUnitCosts: number[],
): { cv: number; band: VarianceBand; flag: string | null } {
  if (effectiveUnitCosts.length < 2) {
    return { cv: 0, band: "NO_COMPARATOR", flag: null };
  }
  const mean =
    effectiveUnitCosts.reduce((a, b) => a + b, 0) / effectiveUnitCosts.length;
  if (mean === 0) return { cv: 0, band: "NORMAL_VARIANCE", flag: null };
  const variance =
    effectiveUnitCosts.reduce((a, b) => a + (b - mean) ** 2, 0) /
    effectiveUnitCosts.length;
  const cv = Math.sqrt(variance) / mean;
  if (cv >= 0.5) {
    return {
      cv,
      band: "EXTREME_VARIANCE",
      flag: "CROSS_SOURCE_PRICE_VARIANCE",
    };
  }
  if (cv >= 0.25) {
    return { cv, band: "HIGH_VARIANCE", flag: "CROSS_SOURCE_PRICE_VARIANCE" };
  }
  return { cv, band: "NORMAL_VARIANCE", flag: null };
}
