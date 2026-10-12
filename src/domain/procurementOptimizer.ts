/**
 * Procurement Optimizer V1 orchestrator.
 * Builds full candidates, ranks, optimizes strategy — never bypasses integrity.
 */

import { assessSpecificationEquivalence } from "./specificationEquivalence";
import { assessStock } from "./stockAssessment";
import { assessSupplierCredibility } from "./supplierCredibility";
import { reconcileQuantity } from "./quantityReconciliation";
import { normalizeSupplierPriceForComparison } from "./vatNormalization";
import { resolveDelivery } from "./deliveryResolution";
import {
  computeCandidateLandedCost,
  type ProcurementCandidate,
} from "./procurementCandidate";
import { rankProcurementCandidates } from "./procurementRanking";
import {
  optimizeProcurementStrategy,
  type ProcurementStrategy,
} from "./procurementStrategy";
import type { DeliveryEvidence } from "./deliveryEvidence";
import { roundMoney } from "./money";

export type OptimizerCandidateInput = {
  id: string;
  supplier: string;
  sourceUrl?: string | null;
  sourceType: string;
  productTitle: string;
  brand?: string | null;
  sku?: string | null;
  productDescription?: string | null;
  displayedPrice: number | null;
  priceKnown: boolean;
  vatTreatment?: string | null;
  packSize?: number | null;
  availability?: string | null;
  delivery?: DeliveryEvidence | null;
  deliveryTexts?: string[];
  sourceQuality?: number;
  retrievedAt?: Date;
  domain?: string | null;
};

export type LineOptimizerInput = {
  lineNumber: number;
  description: string;
  tenderQuantity: number;
  tenderUnit: string;
  brandRequirement?: string | null;
  modelRequirement?: string | null;
  equivalentAllowed: boolean;
  technicalSpecifications?: string[];
  candidates: OptimizerCandidateInput[];
  splitAllowed?: boolean;
  tenderProhibitsSplit?: boolean;
};

export type LineOptimizerResult = {
  lineNumber: number;
  candidates: ProcurementCandidate[];
  ranked: ReturnType<typeof rankProcurementCandidates>;
  strategy: ProcurementStrategy;
  recommendedCandidateId: string | null;
  winnerReason: string;
  metrics: {
    candidateCount: number;
    commerciallyUsable: number;
    exactOrEquivalent: number;
    ambiguous: number;
  };
};

export function optimizeLineProcurement(
  input: LineOptimizerInput,
): LineOptimizerResult {
  const built = input.candidates.map((c) =>
    buildProcurementCandidate(c, input),
  );

  const ranked = rankProcurementCandidates(built);
  const strategy = optimizeProcurementStrategy({
    tenderQuantity: input.tenderQuantity,
    candidates: built,
    splitAllowed: input.splitAllowed,
    tenderProhibitsSplit: input.tenderProhibitsSplit,
  });

  const recommended =
    strategy.type === "SPLIT_SUPPLIER"
      ? null
      : strategy.winnerCandidateId;

  const winnerReason =
    strategy.type === "SPLIT_SUPPLIER"
      ? strategy.reasoning
      : ranked.find((r) => r.candidate.id === recommended)?.reasons.join("; ") ??
        strategy.reasoning;

  return {
    lineNumber: input.lineNumber,
    candidates: built,
    ranked,
    strategy,
    recommendedCandidateId: recommended,
    winnerReason,
    metrics: {
      candidateCount: built.length,
      commerciallyUsable: ranked.filter((r) => r.comparable).length,
      exactOrEquivalent: built.filter((c) =>
        ["EXACT", "EQUIVALENT", "BETTER_THAN_REQUIRED"].includes(
          c.specification.classification,
        ),
      ).length,
      ambiguous: built.filter((c) =>
        ["PARTIAL", "AMBIGUOUS", "INCOMPATIBLE"].includes(
          c.specification.classification,
        ),
      ).length,
    },
  };
}

export function buildProcurementCandidate(
  c: OptimizerCandidateInput,
  line: Omit<LineOptimizerInput, "candidates">,
): ProcurementCandidate {
  const spec = assessSpecificationEquivalence({
    requiredDescription: line.description,
    requiredBrand: line.brandRequirement,
    requiredModel: line.modelRequirement,
    requiredAttributes: line.technicalSpecifications,
    equivalentAllowed: line.equivalentAllowed,
    candidateDescription: c.productTitle,
    candidateBrand: c.brand,
    candidateModel: c.sku,
    candidatePartNumber: c.sku,
    candidateSpecText: c.productDescription,
    orEquivalentExplicit: line.equivalentAllowed,
  });

  const recon =
    c.priceKnown && c.displayedPrice != null
      ? reconcileQuantity({
          tenderQuantity: line.tenderQuantity,
          tenderUnit: line.tenderUnit,
          productName: c.productTitle,
          productDescription: c.productDescription,
          observedSupplierPrice: c.displayedPrice,
          explicitPackSize: c.packSize,
        })
      : null;

  const vatBasis =
    c.vatTreatment === "INCLUSIVE" || c.vatTreatment === "VAT_INCLUSIVE"
      ? "VAT_INCLUSIVE"
      : c.vatTreatment === "EXCLUSIVE" || c.vatTreatment === "VAT_EXCLUSIVE"
        ? "VAT_EXCLUSIVE"
        : c.vatTreatment === "NON_VAT"
          ? "NON_VAT"
          : "UNKNOWN";

  const vatNormalized =
    c.displayedPrice != null
      ? normalizeSupplierPriceForComparison({
          price: c.displayedPrice,
          vatBasis,
        })
      : null;

  const stock = assessStock({
    availabilityText: c.availability,
    pageText: c.productDescription,
  });

  const credibility = assessSupplierCredibility({
    sourceName: c.supplier,
    sourceUrl: c.sourceUrl,
    sourceType: c.sourceType,
    domain: c.domain,
    sourceQuality: c.sourceQuality,
  });

  const productCost = recon?.firm ? recon.procurementCost : null;

  const deliveryRes = resolveDelivery({
    primary: c.delivery ?? {
      type: "UNKNOWN_DELIVERY",
      amount: null,
      threshold: null,
      destinationAssumption: null,
      source: c.sourceUrl ?? null,
      known: false,
      notes: [],
    },
    additionalTexts: c.deliveryTexts,
    productCost: productCost ?? (c.displayedPrice ?? 0) * line.tenderQuantity,
    researchAttempted: Boolean(c.deliveryTexts?.length),
  });

  const deliveryAllocation = deliveryRes.amountForLanded;
  const landed = computeCandidateLandedCost({
    productCost,
    deliveryCost: deliveryAllocation,
    tenderQuantity: line.tenderQuantity,
  });

  const integrityFlags: string[] = [];
  if (!recon?.firm) integrityFlags.push("QUANTITY_NOT_FIRM");
  if (!credibility.autonomousEligible) {
    integrityFlags.push("CREDIBILITY_LOW_OR_UNKNOWN");
  }
  if (stock.class === "OUT_OF_STOCK") integrityFlags.push("OUT_OF_STOCK");
  if (deliveryRes.blocksAutoQuoted) integrityFlags.push("DELIVERY_BLOCKS");

  return {
    id: c.id,
    supplier: c.supplier,
    sourceUrl: c.sourceUrl ?? null,
    sourceType: c.sourceType,
    productTitle: c.productTitle,
    brand: c.brand ?? null,
    sku: c.sku ?? null,
    tenderSpecification: line.description,
    extractedSupplierSpecification: c.productDescription ?? null,
    unitOfMeasure: line.tenderUnit,
    supplierSellingUnit: recon?.supplierSellingUnit ?? "UNKNOWN",
    packSize: recon?.supplierPackSize ?? c.packSize ?? null,
    priceBasis: recon?.supplierPriceBasis ?? "UNKNOWN",
    displayedPrice: c.displayedPrice,
    vatStatus: vatBasis,
    vatNormalized,
    stock,
    delivery: deliveryRes.materiality,
    deliveryCharge: deliveryAllocation,
    deliveryGeography: deliveryRes.geography,
    timestamp: (c.retrievedAt ?? new Date()).toISOString(),
    evidenceQuality: c.sourceQuality ?? 0.5,
    specification: spec,
    quantityReconciliation: recon,
    packsRequired: recon?.packsRequired ?? null,
    unitsPurchased: recon?.unitsPurchased ?? null,
    surplusUnits: recon?.surplusUnits ?? null,
    procurementSubtotal: productCost,
    deliveryAllocation,
    otherKnownProcurementCosts: 0,
    landedProcurementCost: landed.landedProcurementCost,
    effectiveTenderUnitCost: landed.effectiveTenderUnitCost,
    commercialIntegrityFirm: Boolean(recon?.firm),
    integrityFlags,
  };
}

export type OptimizerRfqMetrics = {
  linesResearched: number;
  totalCandidates: number;
  avgCandidatesPerLine: number;
  linesWithAtLeast3: number;
  exactOrEquivalent: number;
  ambiguousMatches: number;
  linesOptimized: number;
  singleSupplierStrategies: number;
  splitSupplierStrategies: number;
  stockBlocked: number;
  deliveryBlocked: number;
  integrityBlocked: number;
  potentialSavingsVsFirstValid: number;
};

export function aggregateOptimizerMetrics(
  results: LineOptimizerResult[],
): OptimizerRfqMetrics {
  let totalCandidates = 0;
  let linesWith3 = 0;
  let exact = 0;
  let ambiguous = 0;
  let optimized = 0;
  let single = 0;
  let split = 0;
  let stockBlocked = 0;
  let deliveryBlocked = 0;
  let integrityBlocked = 0;
  let savings = 0;

  for (const r of results) {
    totalCandidates += r.candidates.length;
    if (r.candidates.length >= 3) linesWith3 += 1;
    exact += r.metrics.exactOrEquivalent;
    ambiguous += r.metrics.ambiguous;
    if (
      r.strategy.type === "SINGLE_SUPPLIER" ||
      r.strategy.type === "SPLIT_SUPPLIER"
    ) {
      optimized += 1;
    }
    if (r.strategy.type === "SINGLE_SUPPLIER") single += 1;
    if (r.strategy.type === "SPLIT_SUPPLIER") split += 1;
    stockBlocked += r.candidates.filter((c) =>
      c.integrityFlags.includes("OUT_OF_STOCK"),
    ).length;
    deliveryBlocked += r.candidates.filter((c) =>
      c.integrityFlags.includes("DELIVERY_BLOCKS"),
    ).length;
    integrityBlocked += r.candidates.filter((c) => !c.commercialIntegrityFirm)
      .length;
    if (r.strategy.savingsVsFirstValid != null) {
      savings += Math.max(0, r.strategy.savingsVsFirstValid);
    }
  }

  return {
    linesResearched: results.length,
    totalCandidates,
    avgCandidatesPerLine:
      results.length > 0 ? roundMoney(totalCandidates / results.length) : 0,
    linesWithAtLeast3: linesWith3,
    exactOrEquivalent: exact,
    ambiguousMatches: ambiguous,
    linesOptimized: optimized,
    singleSupplierStrategies: single,
    splitSupplierStrategies: split,
    stockBlocked,
    deliveryBlocked,
    integrityBlocked,
    potentialSavingsVsFirstValid: roundMoney(savings),
  };
}
