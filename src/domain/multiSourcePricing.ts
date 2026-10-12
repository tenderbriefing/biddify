/**
 * Multi-source price validation and procurement price selection.
 * Cheapest alone never wins.
 */

import { roundMoney, toNumber } from "./money";
import { RESEARCH_POLICY } from "./researchPolicy";

export type PriceObservation = {
  id: string;
  price: number;
  sourceQuality: number;
  matchSelectable: boolean;
  freshnessOk: boolean;
  packResolved: boolean;
  flags?: string[];
};

export type MultiSourceValidation = {
  count: number;
  lowest: number | null;
  median: number | null;
  highest: number | null;
  selectedProcurementPrice: number | null;
  selectedId: string | null;
  dispersionCv: number | null;
  flags: string[];
  rejected: Array<{ id: string; reason: string }>;
  alternatives: string[];
};

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? roundMoney((s[mid - 1] + s[mid]) / 2)
    : s[mid];
}

export function validateMultiSourcePrices(
  observations: PriceObservation[],
  opts?: { highValueLine?: boolean },
): MultiSourceValidation {
  const policy = RESEARCH_POLICY.multiSource;
  const flags: string[] = [];
  const rejected: Array<{ id: string; reason: string }> = [];

  const valid = observations.filter((o) => {
    if (!o.matchSelectable) {
      rejected.push({ id: o.id, reason: "Specification not auto-selectable" });
      return false;
    }
    if (!o.freshnessOk) {
      rejected.push({ id: o.id, reason: "STALE_PRICE / expired freshness" });
      flags.push("STALE_PRICE");
      return false;
    }
    if (!o.packResolved) {
      rejected.push({ id: o.id, reason: "PACK_SIZE_AMBIGUITY" });
      return false;
    }
    if ((o.flags ?? []).includes("WEAK_SOURCE") || o.sourceQuality < 0.4) {
      flags.push("WEAK_SOURCE");
    }
    return o.price > 0 && Number.isFinite(o.price);
  });

  if (valid.length === 0) {
    return {
      count: 0,
      lowest: null,
      median: null,
      highest: null,
      selectedProcurementPrice: null,
      selectedId: null,
      dispersionCv: null,
      flags: [...new Set([...flags, "NO_VALID_CANDIDATES"])],
      rejected,
      alternatives: [],
    };
  }

  if (valid.length === 1) flags.push("SINGLE_SOURCE_PRICE");

  const prices = valid.map((v) => toNumber(v.price));
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const med = median(prices);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance =
    prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length;
  const cv = mean === 0 ? 0 : Math.sqrt(variance) / mean;
  if (cv >= policy.highDispersionCv) flags.push("HIGH_PRICE_DISPERSION");

  // Outlier: far below median cluster
  for (const v of valid) {
    if (med > 0 && (med - v.price) / med >= policy.outlierRelativeDeviation) {
      flags.push("PRICE_OUTLIER");
      rejected.push({
        id: v.id,
        reason: `PRICE_OUTLIER R${v.price} vs median R${med}`,
      });
    }
  }

  const nonOutliers = valid.filter(
    (v) =>
      !(med > 0 && (med - v.price) / med >= policy.outlierRelativeDeviation),
  );
  const pool = nonOutliers.length > 0 ? nonOutliers : valid;

  // Score: quality first, then price proximity to median, then lower price
  const scored = pool
    .map((v) => {
      const priceScore =
        med > 0 ? 1 - Math.min(1, Math.abs(v.price - med) / med) : 0.5;
      const score = v.sourceQuality * 0.55 + priceScore * 0.25 + (1 - v.price / (highest || v.price)) * 0.2;
      return { v, score };
    })
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const minNeeded = opts?.highValueLine
    ? policy.highValueMinObservations
    : policy.preferMinObservations;
  if (valid.length < minNeeded) {
    flags.push("SINGLE_SOURCE_PRICE");
  }

  return {
    count: valid.length,
    lowest: roundMoney(lowest),
    median: med,
    highest: roundMoney(highest),
    selectedProcurementPrice: roundMoney(winner.v.price),
    selectedId: winner.v.id,
    dispersionCv: roundMoney(cv * 100) / 100,
    flags: [...new Set(flags)],
    rejected,
    alternatives: scored.slice(1).map((s) => s.v.id),
  };
}
