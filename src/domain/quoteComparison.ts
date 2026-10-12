import type { SpecMatchState } from "./specMatch";

export type ComparisonOffer = {
  supplierId: string;
  supplierName: string;
  unitCost: number | null;
  lineTotal: number | null;
  deliveryCost: number | null;
  deliveryKnown: boolean;
  leadTimeDays: number | null;
  matchState: SpecMatchState;
  evidenceType: string;
  quoteLineId: string;
};

export type ComparisonRow = {
  rfqLineItemId: string;
  description: string;
  quantity: number;
  specification?: string | null;
  offers: ComparisonOffer[];
  recommendedSupplierId?: string;
  recommendationReason?: string;
};

export type SplitSourceSelection = {
  rfqLineItemId: string;
  supplierId: string;
  quoteLineId: string;
};

/**
 * Recommend lowest known compliant unit cost; never prefer NON_COMPLIANT.
 * Unknown prices are ignored for recommendation.
 */
export function recommendOffer(
  offers: ComparisonOffer[],
): { supplierId?: string; reason: string } {
  const eligible = offers.filter(
    (o) =>
      o.unitCost != null &&
      o.matchState !== "NON_COMPLIANT" &&
      o.matchState !== "UNKNOWN",
  );
  if (eligible.length === 0) {
    const known = offers.filter((o) => o.unitCost != null);
    if (known.length === 0) {
      return { reason: "No known prices — cannot recommend" };
    }
    const cheapest = [...known].sort((a, b) => a.unitCost! - b.unitCost!)[0]!;
    return {
      supplierId: cheapest.supplierId,
      reason: `Cheapest known price but match state ${cheapest.matchState} — verify before use`,
    };
  }
  const ranked = [...eligible].sort((a, b) => {
    const matchRank = (m: SpecMatchState) =>
      m === "EXACT_MATCH" ? 0 : m === "COMPLIANT_EQUIVALENT" ? 1 : 2;
    const mr = matchRank(a.matchState) - matchRank(b.matchState);
    if (mr !== 0) return mr;
    return a.unitCost! - b.unitCost!;
  });
  const best = ranked[0]!;
  return {
    supplierId: best.supplierId,
    reason: `${best.matchState} at R${best.unitCost!.toFixed(2)}`,
  };
}

export function buildComparisonRows(
  rows: Omit<ComparisonRow, "recommendedSupplierId" | "recommendationReason">[],
): ComparisonRow[] {
  return rows.map((row) => {
    const rec = recommendOffer(row.offers);
    return {
      ...row,
      recommendedSupplierId: rec.supplierId,
      recommendationReason: rec.reason,
    };
  });
}

/**
 * Sum goods cost for a split-source selection. Returns null if any price unknown.
 */
export function calculateSplitSourceGoodsCost(
  selections: Array<{ quantity: number; unitCost: number | null }>,
): number | null {
  let total = 0;
  for (const s of selections) {
    if (s.unitCost == null) return null;
    total += s.quantity * s.unitCost;
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}
