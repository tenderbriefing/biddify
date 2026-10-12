/**
 * Refresh pricing from VERIFIED SUPPLIER_QUOTE evidence only.
 * Never silently overwrite history — callers must version scenarios.
 */

import { calculatePricing } from "./pricing";
import type { SystemSourcingRecommendation } from "./commercialComparison";

export type PricingRefreshInput = {
  recommendation: SystemSourcingRecommendation;
  markupPercent: number;
  /** Bidding company VAT registration — controls output VAT, not supplier VAT. */
  companyVatRegistered: boolean;
  vatRatePercent?: number;
};

export type PricingRefreshResult = {
  pricingBasis: "VERIFIED_SUPPLIER";
  supplierCost: number;
  delivery: number;
  deliveryKnown: boolean;
  landedCost: number;
  markupPercent: number;
  markupAmount: number;
  sellingPriceExVat: number;
  vatAmount: number;
  totalQuotation: number;
  grossProfit: number;
  grossMarginPercent: number;
  evidenceQuoteIds: string[];
  blockers: string[];
  ok: boolean;
};

export function refreshPricingFromVerifiedQuotes(
  input: PricingRefreshInput,
): PricingRefreshResult {
  const blockers = [...input.recommendation.blockers];
  if (input.recommendation.lines.length === 0) {
    blockers.push("No sourcing lines in recommendation");
  }
  if (!input.recommendation.deliveryKnown) {
    blockers.push("Delivery UNKNOWN — cannot refresh as complete verified pricing");
  }
  if (input.recommendation.totalLandedEstimate == null) {
    blockers.push("Landed cost estimate incomplete");
  }

  const supplierCost = input.recommendation.goodsCost;
  const delivery = input.recommendation.deliveryKnown
    ? input.recommendation.deliveryCost
    : 0;

  const priced = calculatePricing({
    supplierCost,
    delivery,
    markupPercent: input.markupPercent,
    vatRegistered: input.companyVatRegistered,
    vatRatePercent: input.vatRatePercent,
    workingCapitalRequired: supplierCost,
  });

  const ok =
    blockers.filter((b) => /UNKNOWN|incomplete|No sourcing/i.test(b)).length ===
      0 &&
    input.recommendation.lines.length > 0 &&
    input.recommendation.deliveryKnown;

  return {
    pricingBasis: "VERIFIED_SUPPLIER",
    supplierCost: priced.supplierCost,
    delivery: priced.delivery,
    deliveryKnown: input.recommendation.deliveryKnown,
    landedCost: priced.landedCost,
    markupPercent: priced.markupPercent,
    markupAmount: priced.markupAmount,
    sellingPriceExVat: priced.sellingPriceExVat,
    vatAmount: priced.vatAmount,
    totalQuotation: priced.totalQuotation,
    grossProfit: priced.grossProfit,
    grossMarginPercent: priced.grossMarginPercent,
    evidenceQuoteIds: input.recommendation.quoteIds,
    blockers,
    ok,
  };
}

export function pricingEvidenceLabel(basis: "PROVISIONAL" | "VERIFIED_SUPPLIER"): string {
  return basis === "VERIFIED_SUPPLIER"
    ? "VERIFIED SUPPLIER PRICING"
    : "PROVISIONAL PRICING";
}
