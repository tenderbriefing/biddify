/**
 * Founder markup policy V1.
 * Markup applies to LANDED COST. Never confuse markup % with gross margin %.
 */

import {
  applyMarkup,
  calculateGrossMarginPercent,
  calculateGrossProfit,
} from "./pricing";

export const MARKUP_RISK_BANDS = [
  "LOW_RISK",
  "NORMAL",
  "HIGHER_OPERATIONAL_OR_PRICING_RISK",
] as const;

export type MarkupRiskBand = (typeof MARKUP_RISK_BANDS)[number];

export const MARKUP_BY_BAND: Record<MarkupRiskBand, number> = {
  LOW_RISK: 20,
  NORMAL: 25,
  HIGHER_OPERATIONAL_OR_PRICING_RISK: 30,
};

export type MarkupPolicyInput = {
  highConfidence: boolean;
  unresolvedMinorFlags?: string[];
  deliveryUnknown?: boolean;
  packSizeAmbiguity?: boolean;
  evidenceWeak?: boolean;
  operationalComplexity?: boolean;
  founderOverridePercent?: number | null;
};

export type MarkupPolicyResult = {
  band: MarkupRiskBand;
  markupPercent: number;
  reason: string;
  founderOverride: boolean;
};

export function selectMarkupPolicy(
  input: MarkupPolicyInput,
): MarkupPolicyResult {
  if (
    input.founderOverridePercent != null &&
    Number.isFinite(input.founderOverridePercent)
  ) {
    const pct = Number(input.founderOverridePercent);
    return {
      band:
        pct <= 20
          ? "LOW_RISK"
          : pct >= 30
            ? "HIGHER_OPERATIONAL_OR_PRICING_RISK"
            : "NORMAL",
      markupPercent: pct,
      reason: `Founder override markup ${pct}%`,
      founderOverride: true,
    };
  }

  const riskFlags = [
    input.deliveryUnknown ? "UNKNOWN_DELIVERY_COST" : null,
    input.packSizeAmbiguity ? "PACK_SIZE_AMBIGUITY" : null,
    input.evidenceWeak ? "WEAK_PRICE_EVIDENCE" : null,
    input.operationalComplexity ? "OPERATIONAL_COMPLEXITY" : null,
    ...(input.unresolvedMinorFlags ?? []),
  ].filter(Boolean) as string[];

  if (riskFlags.length >= 2 || input.evidenceWeak) {
    return {
      band: "HIGHER_OPERATIONAL_OR_PRICING_RISK",
      markupPercent: MARKUP_BY_BAND.HIGHER_OPERATIONAL_OR_PRICING_RISK,
      reason: `Higher risk (${riskFlags.join(", ") || "evidence"}) → 30% markup on landed cost`,
      founderOverride: false,
    };
  }

  if (riskFlags.length === 1 || input.deliveryUnknown) {
    return {
      band: "NORMAL",
      markupPercent: MARKUP_BY_BAND.NORMAL,
      reason: `Normal risk (${riskFlags.join(", ") || "baseline"}) → 25% markup on landed cost`,
      founderOverride: false,
    };
  }

  if (input.highConfidence) {
    return {
      band: "LOW_RISK",
      markupPercent: MARKUP_BY_BAND.LOW_RISK,
      reason: "Low risk / high confidence → 20% markup on landed cost",
      founderOverride: false,
    };
  }

  return {
    band: "NORMAL",
    markupPercent: MARKUP_BY_BAND.NORMAL,
    reason: "Default normal band → 25% markup on landed cost",
    founderOverride: false,
  };
}

export function applyMarkupWithMarginDisplay(landedCost: number, markupPercent: number) {
  const { markupAmount, sellingPriceExVat } = applyMarkup(
    landedCost,
    markupPercent,
  );
  const grossProfit = calculateGrossProfit(sellingPriceExVat, landedCost);
  const grossMarginPercent = calculateGrossMarginPercent(
    grossProfit,
    sellingPriceExVat,
  );
  return {
    landedCost,
    markupPercent,
    markupAmount,
    sellingPriceExVat,
    grossProfit,
    grossMarginPercent,
  };
}
