/**
 * Multi-supplier procurement strategy — split only when commercially genuine.
 */

import { roundMoney } from "./money";
import type { ProcurementCandidate } from "./procurementCandidate";
import { rankProcurementCandidates } from "./procurementRanking";
import { isAutonomousSpecSelectable } from "./specificationEquivalence";

export const STRATEGY_TYPES = [
  "SINGLE_SUPPLIER",
  "SPLIT_SUPPLIER",
  "INSUFFICIENT_EVIDENCE",
  "MANUAL_REVIEW",
] as const;

export type StrategyType = (typeof STRATEGY_TYPES)[number];

export type SplitAllocation = {
  candidateId: string;
  supplier: string;
  productTitle: string;
  unitsAllocated: number;
  packsRequired: number;
  productCost: number;
  deliveryAllocation: number;
  landedCost: number;
};

export type ProcurementStrategy = {
  type: StrategyType;
  winnerCandidateId: string | null;
  allocations: SplitAllocation[];
  totalLandedCost: number | null;
  savingsVsSingleBest: number | null;
  savingsVsFirstValid: number | null;
  reasoning: string;
  blockedReasons: string[];
};

export function optimizeProcurementStrategy(input: {
  tenderQuantity: number;
  candidates: ProcurementCandidate[];
  splitAllowed?: boolean;
  tenderProhibitsSplit?: boolean;
}): ProcurementStrategy {
  const ranked = rankProcurementCandidates(input.candidates);
  const usable = ranked.filter((r) => r.disqualified == null && r.comparable);

  if (usable.length === 0) {
    return {
      type: "INSUFFICIENT_EVIDENCE",
      winnerCandidateId: null,
      allocations: [],
      totalLandedCost: null,
      savingsVsSingleBest: null,
      savingsVsFirstValid: null,
      reasoning: "No commercially comparable firm candidates",
      blockedReasons: ranked
        .filter((r) => r.disqualified)
        .map((r) => r.disqualified!)
        .slice(0, 8),
    };
  }

  const firstValidLanded = usable[0].candidate.landedProcurementCost!;

  // Prefer a single supplier that can fully cover tender quantity
  const fullCover = usable.find((u) =>
    Boolean(buildFullAllocation(u.candidate, input.tenderQuantity)),
  );
  const singleAlloc = fullCover
    ? buildFullAllocation(fullCover.candidate, input.tenderQuantity)
    : null;

  const splitAllowed =
    input.splitAllowed !== false && input.tenderProhibitsSplit !== true;

  // Always evaluate split when allowed — may beat single or rescue limited stock
  const split =
    splitAllowed && usable.length >= 2
      ? trySplit(
          usable.map((u) => u.candidate),
          input.tenderQuantity,
        )
      : null;

  if (
    split &&
    split.allocations.length >= 2 &&
    (singleAlloc == null ||
      split.totalLanded < singleAlloc.landedCost - 0.01)
  ) {
    return {
      type: "SPLIT_SUPPLIER",
      winnerCandidateId: null,
      allocations: split.allocations,
      totalLandedCost: split.totalLanded,
      savingsVsSingleBest: singleAlloc
        ? roundMoney(singleAlloc.landedCost - split.totalLanded)
        : null,
      savingsVsFirstValid: roundMoney(firstValidLanded - split.totalLanded),
      reasoning: singleAlloc
        ? `Split sourcing saves R${roundMoney(singleAlloc.landedCost - split.totalLanded)} vs single best after including separate delivery`
        : `Split sourcing required — no single supplier covers full quantity with firm economics`,
      blockedReasons: [],
    };
  }

  if (singleAlloc && fullCover) {
    return {
      type: "SINGLE_SUPPLIER",
      winnerCandidateId: fullCover.candidate.id,
      allocations: [singleAlloc],
      totalLandedCost: singleAlloc.landedCost,
      savingsVsSingleBest: 0,
      savingsVsFirstValid: 0,
      reasoning: `Single supplier: ${fullCover.candidate.supplier} — ${fullCover.reasons.join("; ")}`,
      blockedReasons: [],
    };
  }

  return {
    type: "MANUAL_REVIEW",
    winnerCandidateId: usable[0].candidate.id,
    allocations: [],
    totalLandedCost: null,
    savingsVsSingleBest: null,
    savingsVsFirstValid: null,
    reasoning: "No single or split strategy can cover tender with firm candidates",
    blockedReasons: ["Stock/quantity cannot cover tender"],
  };
}

function buildFullAllocation(
  c: ProcurementCandidate,
  tenderQty: number,
): SplitAllocation | null {
  if (!c.commercialIntegrityFirm || c.procurementSubtotal == null) return null;
  if (!isAutonomousSpecSelectable(c.specification.classification)) return null;
  if (!c.stock.eligibleToWin) return null;
  if (
    c.stock.maxSupplyUnits != null &&
    c.stock.maxSupplyUnits < tenderQty
  ) {
    return null;
  }
  const packs =
    c.packsRequired ??
    (c.packSize && c.packSize > 0
      ? Math.ceil(tenderQty / c.packSize)
      : tenderQty);
  return {
    candidateId: c.id,
    supplier: c.supplier,
    productTitle: c.productTitle,
    unitsAllocated: tenderQty,
    packsRequired: packs,
    productCost: c.procurementSubtotal,
    deliveryAllocation: c.deliveryAllocation,
    landedCost: c.landedProcurementCost ?? c.procurementSubtotal,
  };
}

function trySplit(
  candidates: ProcurementCandidate[],
  tenderQty: number,
): { allocations: SplitAllocation[]; totalLanded: number } | null {
  // Prefer candidates with limited stock that is cheaper
  const limited = candidates
    .filter(
      (c) =>
        c.stock.maxSupplyUnits != null &&
        c.stock.maxSupplyUnits > 0 &&
        c.stock.maxSupplyUnits < tenderQty &&
        c.commercialIntegrityFirm &&
        c.procurementSubtotal != null &&
        c.effectiveTenderUnitCost != null,
    )
    .sort(
      (a, b) =>
        (a.effectiveTenderUnitCost ?? 9999) -
        (b.effectiveTenderUnitCost ?? 9999),
    );

  if (limited.length === 0) return null;

  const primary = limited[0];
  const unitsA = Math.min(primary.stock.maxSupplyUnits!, tenderQty);
  const unitsB = tenderQty - unitsA;
  if (unitsB <= 0) return null;

  const secondary = candidates.find(
    (c) =>
      c.id !== primary.id &&
      c.commercialIntegrityFirm &&
      c.procurementSubtotal != null &&
      c.effectiveTenderUnitCost != null &&
      (c.stock.maxSupplyUnits == null || c.stock.maxSupplyUnits >= unitsB) &&
      isAutonomousSpecSelectable(c.specification.classification),
  );
  if (!secondary) return null;

  const packA = primary.packSize && primary.packSize > 0 ? primary.packSize : 1;
  const packB =
    secondary.packSize && secondary.packSize > 0 ? secondary.packSize : 1;
  const packsA = Math.ceil(unitsA / packA);
  const packsB = Math.ceil(unitsB / packB);

  // Scale product cost by packs (use observed pack price via effective)
  const productA = roundMoney(
    packsA * (primary.displayedPrice ?? primary.effectiveTenderUnitCost! * packA),
  );
  const productB = roundMoney(
    packsB *
      (secondary.displayedPrice ?? secondary.effectiveTenderUnitCost! * packB),
  );

  // Separate delivery charges — never ignore
  const delA = roundMoney(primary.deliveryAllocation);
  const delB = roundMoney(secondary.deliveryAllocation);

  const allocs: SplitAllocation[] = [
    {
      candidateId: primary.id,
      supplier: primary.supplier,
      productTitle: primary.productTitle,
      unitsAllocated: unitsA,
      packsRequired: packsA,
      productCost: productA,
      deliveryAllocation: delA,
      landedCost: roundMoney(productA + delA),
    },
    {
      candidateId: secondary.id,
      supplier: secondary.supplier,
      productTitle: secondary.productTitle,
      unitsAllocated: unitsB,
      packsRequired: packsB,
      productCost: productB,
      deliveryAllocation: delB,
      landedCost: roundMoney(productB + delB),
    },
  ];

  return {
    allocations: allocs,
    totalLanded: roundMoney(allocs.reduce((s, a) => s + a.landedCost, 0)),
  };
}
