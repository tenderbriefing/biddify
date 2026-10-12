/**
 * Centralized live research policy — freshness, budgets, delivery materiality.
 * Do not scatter magic numbers across the codebase.
 */

export const RESEARCH_POLICY = {
  freshness: {
    freshMaxDays: 7,
    acceptableMaxDays: 30,
    staleMaxDays: 90,
  },
  budget: {
    maxQueriesPerLine: 5,
    maxSearchResultsPerQuery: 8,
    maxPagesInspectedPerLine: 8,
    maxRetriesPerFetch: 1,
    fetchTimeoutMs: 12_000,
    perRfqMaxFetches: 100,
    perRfqMaxDurationMs: 300_000,
    /** Procurement Optimizer V1 — seek enough evidence for a decision. */
    minCandidatesTargetPerLine: 3,
    maxSecondSourceVarianceSearches: 4,
    maxDeliveryResolutionAttempts: 2,
  },
  optimizer: {
    enabled: true,
    preferLandedOverDisplayed: true,
    allowSplitSupplier: true,
  },
  delivery: {
    /** Fraction of product cost above which unknown delivery is MATERIAL. */
    materialityFraction: 0.08,
    /** Absolute ZAR floor for material unknown delivery. */
    materialityFloorZar: 500,
    /** Low-materiality delivery allowance as fraction of product cost. */
    lowMaterialityAllowanceFraction: 0.03,
    /** Cap on delivery risk allowance (ZAR). */
    lowMaterialityAllowanceCapZar: 350,
  },
  multiSource: {
    preferMinObservations: 2,
    highValueMinObservations: 3,
    highValueLineThresholdZar: 5_000,
    outlierRelativeDeviation: 0.35,
    highDispersionCv: 0.25,
  },
  autoQuoted: {
    minLineConfidence: 0.65,
    minOverallConfidence: 0.7,
    requireMultiSourceUnlessHighQuality: true,
  },
} as const;

export type FreshnessBand = "FRESH" | "ACCEPTABLE" | "STALE" | "EXPIRED_FOR_AUTONOMOUS_PRICING";

export function freshnessBand(
  ageDays: number,
  policy = RESEARCH_POLICY.freshness,
): FreshnessBand {
  if (ageDays <= policy.freshMaxDays) return "FRESH";
  if (ageDays <= policy.acceptableMaxDays) return "ACCEPTABLE";
  if (ageDays <= policy.staleMaxDays) return "STALE";
  return "EXPIRED_FOR_AUTONOMOUS_PRICING";
}

export function ageDaysFromRetrieved(
  retrievedAt: Date,
  now: Date = new Date(),
): number {
  return Math.max(0, (now.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60 * 24));
}

export function isUsableForAutonomousPricing(band: FreshnessBand): boolean {
  return band === "FRESH" || band === "ACCEPTABLE";
}
