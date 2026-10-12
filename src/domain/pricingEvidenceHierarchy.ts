/**
 * Pricing evidence hierarchy for autonomous sourcing.
 * AI_ESTIMATE must NEVER be treated as equivalent to observed market pricing.
 */

export const PRICING_EVIDENCE_LEVELS = [
  "FORMAL_SUPPLIER_QUOTE",
  "SUPPLIER_API_PRICE",
  "DISTRIBUTOR_WEB_PRICE",
  "WHOLESALER_WEB_PRICE",
  "RETAIL_WEB_PRICE",
  "HISTORICAL_VERIFIED_PRICE",
  "PUBLIC_PRICE_REFERENCE",
  "AI_ESTIMATE",
] as const;

export type PricingEvidenceLevel = (typeof PRICING_EVIDENCE_LEVELS)[number];

const RANK: Record<PricingEvidenceLevel, number> = {
  FORMAL_SUPPLIER_QUOTE: 100,
  SUPPLIER_API_PRICE: 90,
  DISTRIBUTOR_WEB_PRICE: 80,
  WHOLESALER_WEB_PRICE: 70,
  RETAIL_WEB_PRICE: 60,
  HISTORICAL_VERIFIED_PRICE: 50,
  PUBLIC_PRICE_REFERENCE: 40,
  AI_ESTIMATE: 10,
};

/** Max age (hours) before evidence is considered stale for AUTO_QUOTED. */
export const STALE_EVIDENCE_HOURS: Record<PricingEvidenceLevel, number> = {
  FORMAL_SUPPLIER_QUOTE: 24 * 14,
  SUPPLIER_API_PRICE: 24 * 3,
  DISTRIBUTOR_WEB_PRICE: 24 * 7,
  WHOLESALER_WEB_PRICE: 24 * 7,
  RETAIL_WEB_PRICE: 24 * 7,
  HISTORICAL_VERIFIED_PRICE: 24 * 30,
  PUBLIC_PRICE_REFERENCE: 24 * 14,
  AI_ESTIMATE: 0, // never fresh enough for AUTO
};

export function evidenceRank(level: PricingEvidenceLevel): number {
  return RANK[level];
}

export function isStrongerEvidence(
  a: PricingEvidenceLevel,
  b: PricingEvidenceLevel,
): boolean {
  return RANK[a] > RANK[b];
}

export function isAiEstimate(level: PricingEvidenceLevel): boolean {
  return level === "AI_ESTIMATE";
}

export function isStaleEvidence(
  level: PricingEvidenceLevel,
  ageHours: number | null | undefined,
): boolean {
  if (level === "AI_ESTIMATE") return true;
  if (ageHours == null || !Number.isFinite(ageHours)) return true;
  return ageHours > STALE_EVIDENCE_HOURS[level];
}

/** Minimum evidence quality for AUTO_QUOTED (V1). */
export function meetsAutoQuotedEvidenceFloor(
  level: PricingEvidenceLevel,
): boolean {
  return RANK[level] >= RANK.PUBLIC_PRICE_REFERENCE && level !== "AI_ESTIMATE";
}

/**
 * Map legacy QuoteEvidenceType onto the autonomous hierarchy.
 * MANUAL_ESTIMATE → AI_ESTIMATE (never auto-equivalent to market prices).
 */
export function mapLegacyQuoteEvidence(
  type: string,
  sourceHint?: string | null,
): PricingEvidenceLevel {
  switch (type) {
    case "SUPPLIER_QUOTE":
      return "FORMAL_SUPPLIER_QUOTE";
    case "HISTORICAL_PRICE":
      return "HISTORICAL_VERIFIED_PRICE";
    case "MANUAL_ESTIMATE":
      return "AI_ESTIMATE";
    case "PUBLIC_PRICE_REFERENCE": {
      const h = (sourceHint ?? "").toLowerCase();
      if (h.includes("wholesal") || h.includes("makro") || h.includes("trade")) {
        return "WHOLESALER_WEB_PRICE";
      }
      if (h.includes("distribut")) return "DISTRIBUTOR_WEB_PRICE";
      if (h.includes("retail") || h.includes("takealot") || h.includes("checkers")) {
        return "RETAIL_WEB_PRICE";
      }
      return "PUBLIC_PRICE_REFERENCE";
    }
    default:
      return "PUBLIC_PRICE_REFERENCE";
  }
}

export function bestEvidenceLevel(
  levels: PricingEvidenceLevel[],
): PricingEvidenceLevel | null {
  if (levels.length === 0) return null;
  return levels.reduce((best, t) => (RANK[t] > RANK[best] ? t : best));
}
