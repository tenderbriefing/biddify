/**
 * Procurement ranking — price decisive only among commercially comparable offers.
 * Uncertain pack economics must not beat a slightly more expensive firm candidate.
 */

import type { ProcurementCandidate } from "./procurementCandidate";
import { isAutonomousSpecSelectable } from "./specificationEquivalence";

export type RankedCandidate = {
  candidate: ProcurementCandidate;
  rank: number;
  score: number;
  disqualified: string | null;
  comparable: boolean;
  reasons: string[];
};

export function rankProcurementCandidates(
  candidates: ProcurementCandidate[],
): RankedCandidate[] {
  const scored = candidates.map((c) => scoreOne(c));
  const comparable = scored
    .filter((s) => s.disqualified == null && s.comparable)
    .sort((a, b) => {
      const ca = a.candidate.landedProcurementCost ?? Number.POSITIVE_INFINITY;
      const cb = b.candidate.landedProcurementCost ?? Number.POSITIVE_INFINITY;
      if (Math.abs(ca - cb) > 0.01) return ca - cb;
      return b.score - a.score;
    });

  const result: RankedCandidate[] = [];
  let rank = 1;
  for (const s of comparable) {
    result.push({ ...s, rank: rank++ });
  }
  for (const s of scored.filter((x) => x.disqualified != null || !x.comparable)) {
    result.push({ ...s, rank: -1 });
  }
  return result;
}

function scoreOne(c: ProcurementCandidate): Omit<RankedCandidate, "rank"> {
  const reasons: string[] = [];

  if (!isAutonomousSpecSelectable(c.specification.classification)) {
    return {
      candidate: c,
      score: -1,
      disqualified: `Spec ${c.specification.classification} not autonomous-selectable`,
      comparable: false,
      reasons: [`Spec ${c.specification.classification}`],
    };
  }
  if (!c.stock.eligibleToWin || c.stock.class === "OUT_OF_STOCK") {
    return {
      candidate: c,
      score: -1,
      disqualified: "OUT_OF_STOCK / not eligible to win",
      comparable: false,
      reasons: ["Stock blocks win"],
    };
  }
  if (!c.commercialIntegrityFirm) {
    return {
      candidate: c,
      score: -1,
      disqualified:
        "Commercial integrity not firm (pack/price basis/quantity)",
      comparable: false,
      reasons: ["Integrity not firm — cannot beat firm alternatives on price"],
    };
  }
  if (c.landedProcurementCost == null) {
    return {
      candidate: c,
      score: -1,
      disqualified: "No landed procurement cost",
      comparable: false,
      reasons: ["Missing landed cost"],
    };
  }
  if (c.integrityFlags.includes("CREDIBILITY_LOW_OR_UNKNOWN")) {
    return {
      candidate: c,
      score: -1,
      disqualified: "Supplier credibility LOW/UNKNOWN",
      comparable: false,
      reasons: ["Credibility insufficient"],
    };
  }

  if (
    c.delivery?.blocksAutoQuoted &&
    c.delivery.class === "UNKNOWN_MATERIAL"
  ) {
    reasons.push("Delivery material unknown — comparable for review only");
  }

  let score = 0;
  score += c.specification.compatibilityScore * 30;
  score += c.evidenceQuality * 15;
  if (c.commercialIntegrityFirm) score += 20;
  if (c.stock.class === "IN_STOCK_CONFIRMED") score += 10;
  else if (c.stock.class === "AVAILABLE_TO_ORDER") score += 5;
  else if (c.stock.class === "UNKNOWN") score -= 5;
  if (c.delivery && !c.delivery.blocksAutoQuoted) score += 8;
  if ((c.surplusUnits ?? 0) === 0) score += 4;
  else if ((c.surplusUnits ?? 0) > 0) {
    score -= Math.min(
      6,
      (c.surplusUnits ?? 0) / Math.max(c.packsRequired ?? 1, 1),
    );
    reasons.push(`Surplus ${c.surplusUnits} units`);
  }
  if (c.vatNormalized?.usable) score += 5;
  else score -= 8;

  const landed = c.landedProcurementCost;
  const costFactor = Math.max(
    0,
    12 - Math.log10(Math.max(landed, 0.01) + 1) * 3,
  );
  score += costFactor;
  reasons.push(
    `Landed R${landed}; spec ${c.specification.classification}; stock ${c.stock.class}`,
  );

  return {
    candidate: c,
    score,
    disqualified: null,
    comparable: true,
    reasons,
  };
}
