/**
 * Conservative procurement cost selection — cheapest is not automatic.
 */

import { roundMoney } from "./money";

export type ProcurementCandidateCost = {
  id: string;
  effectiveUnitCost: number;
  sourceQuality: number;
  firm: boolean;
};

export type ProcurementCostSelection = {
  selectedId: string | null;
  selectedEffectiveUnitCost: number | null;
  strategy: "LOW_CREDIBLE" | "MEDIAN_LIKE" | "CONSERVATIVE" | "NONE";
  reason: string;
};

export function selectProcurementCost(
  candidates: ProcurementCandidateCost[],
  opts?: { highConfidence?: boolean; highDispersion?: boolean },
): ProcurementCostSelection {
  const firm = candidates.filter((c) => c.firm && c.effectiveUnitCost > 0);
  if (firm.length === 0) {
    return {
      selectedId: null,
      selectedEffectiveUnitCost: null,
      strategy: "NONE",
      reason: "No firm quantity-reconciled candidates",
    };
  }

  const sorted = [...firm].sort(
    (a, b) => a.effectiveUnitCost - b.effectiveUnitCost,
  );

  if (opts?.highDispersion) {
    // Conservative: use 75th percentile-ish (higher cost)
    const idx = Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * 0.75),
    );
    const pick = sorted[idx];
    return {
      selectedId: pick.id,
      selectedEffectiveUnitCost: roundMoney(pick.effectiveUnitCost),
      strategy: "CONSERVATIVE",
      reason: "HIGH dispersion — conservative valid evidence selected",
    };
  }

  if (opts?.highConfidence && sorted[0].sourceQuality >= 0.7) {
    return {
      selectedId: sorted[0].id,
      selectedEffectiveUnitCost: roundMoney(sorted[0].effectiveUnitCost),
      strategy: "LOW_CREDIBLE",
      reason: "HIGH_CONFIDENCE + strong source — credible low price used",
    };
  }

  // Median-like
  const mid = sorted[Math.floor((sorted.length - 1) / 2)];
  return {
    selectedId: mid.id,
    selectedEffectiveUnitCost: roundMoney(mid.effectiveUnitCost),
    strategy: "MEDIAN_LIKE",
    reason: "NORMAL confidence — defensible/median-like procurement price",
  };
}
