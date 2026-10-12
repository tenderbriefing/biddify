/**
 * Select best VALID commercial candidate per BOQ line.
 * Never select cheapest alone; never select MISMATCH.
 */

import {
  mayAutoSelect,
  type SpecMatchVerdict,
} from "./specificationMatching";
import {
  evidenceRank,
  isAiEstimate,
  isStaleEvidence,
  type PricingEvidenceLevel,
} from "./pricingEvidenceHierarchy";

export type ProductCandidateScoreInput = {
  id: string;
  matchVerdict: SpecMatchVerdict;
  matchConfidence: number;
  evidenceLevel: PricingEvidenceLevel;
  evidenceAgeHours: number | null;
  effectiveUnitCost: number | null;
  priceKnown: boolean;
  availabilityKnown: boolean;
  packSizeCorrect: boolean;
  deliveryKnown: boolean;
  sourceCredibility: number; // 0–1
};

export type ProductSelectionResult = {
  selectedId: string | null;
  score: number | null;
  reason: string;
  alternativeIds: string[];
  rejected: Array<{ id: string; reason: string }>;
};

function scoreCandidate(c: ProductCandidateScoreInput): {
  score: number;
  disqualified: string | null;
} {
  if (c.matchVerdict === "MISMATCH") {
    return { score: -1, disqualified: "MISMATCH must never be selected" };
  }
  if (!c.priceKnown || c.effectiveUnitCost == null) {
    return { score: -1, disqualified: "No credible price" };
  }
  if (isAiEstimate(c.evidenceLevel)) {
    return {
      score: -1,
      disqualified: "AI_ESTIMATE is not selectable as primary market evidence",
    };
  }
  if (!mayAutoSelect(c.matchVerdict)) {
    return {
      score: -1,
      disqualified: `${c.matchVerdict} not auto-selectable`,
    };
  }

  let score = 0;
  score += c.matchConfidence * 40;
  score += (evidenceRank(c.evidenceLevel) / 100) * 25;
  score += c.sourceCredibility * 10;
  if (c.packSizeCorrect) score += 8;
  if (c.deliveryKnown) score += 5;
  if (c.availabilityKnown) score += 5;
  if (isStaleEvidence(c.evidenceLevel, c.evidenceAgeHours)) {
    score -= 15;
  }
  // Prefer lower unit cost modestly after quality gates
  const costFactor = Math.max(0, 12 - Math.log10(Math.max(c.effectiveUnitCost, 0.01) + 1) * 4);
  score += costFactor;

  return { score, disqualified: null };
}

export function selectBestProductCandidate(
  candidates: ProductCandidateScoreInput[],
): ProductSelectionResult {
  const rejected: Array<{ id: string; reason: string }> = [];
  const scored: Array<{ id: string; score: number }> = [];

  for (const c of candidates) {
    const { score, disqualified } = scoreCandidate(c);
    if (disqualified) {
      rejected.push({ id: c.id, reason: disqualified });
      continue;
    }
    scored.push({ id: c.id, score });
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return {
      selectedId: null,
      score: null,
      reason: "No valid selectable candidate after compliance/evidence gates",
      alternativeIds: [],
      rejected,
    };
  }

  const [winner, ...rest] = scored;
  return {
    selectedId: winner.id,
    score: winner.score,
    reason: `Selected on compliance, evidence quality, pack/delivery, then unit economics (score ${winner.score.toFixed(1)})`,
    alternativeIds: rest.map((r) => r.id),
    rejected,
  };
}
