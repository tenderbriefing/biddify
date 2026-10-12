/**
 * Founder markup policy V2.
 * Markup applies to LANDED COST (product + known delivery + risk allowance + other).
 * UNKNOWN delivery must NOT increase markup — use risk allowance / REVIEW instead.
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
  /** Operational / competitive burden — NOT unknown delivery. */
  operationalComplexity?: boolean;
  /** Large transaction / competition intensity. */
  highCompetitionOrBurden?: boolean;
  /** Small simple supply — may justify low band. */
  simpleTransaction?: boolean;
  founderOverridePercent?: number | null;
  /**
   * @deprecated Unknown delivery must not drive markup. Ignored if passed.
   */
  deliveryUnknown?: boolean;
  packSizeAmbiguity?: boolean;
  evidenceWeak?: boolean;
  unresolvedMinorFlags?: string[];
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

  // Explicitly ignore deliveryUnknown — uncertainty ≠ profit protection
  void input.deliveryUnknown;

  if (input.highCompetitionOrBurden || input.operationalComplexity) {
    return {
      band: "HIGHER_OPERATIONAL_OR_PRICING_RISK",
      markupPercent: MARKUP_BY_BAND.HIGHER_OPERATIONAL_OR_PRICING_RISK,
      reason:
        "Higher operational/competitive burden → 30% markup on landed cost (not for unknown costs)",
      founderOverride: false,
    };
  }

  if (input.highConfidence && input.simpleTransaction !== false) {
    return {
      band: "LOW_RISK",
      markupPercent: MARKUP_BY_BAND.LOW_RISK,
      reason:
        "Low commercial burden / high confidence → 20% markup on landed cost",
      founderOverride: false,
    };
  }

  return {
    band: "NORMAL",
    markupPercent: MARKUP_BY_BAND.NORMAL,
    reason:
      "Normal commercial band → 25% markup on landed cost (unknown delivery handled via allowance/review, not markup)",
    founderOverride: false,
  };
}

export type LandedBreakdownDisplay = {
  productCost: number;
  deliveryCost: number;
  riskAllowance: number;
  otherDirectCost: number;
  landedCost: number;
  markupPercent: number;
  markupAmount: number;
  sellingPriceExVat: number;
  grossProfit: number;
  grossMarginPercent: number;
};

export function applyMarkupWithMarginDisplay(
  landedCost: number,
  markupPercent: number,
) {
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

export function buildLandedBreakdown(input: {
  productCost: number;
  deliveryCost: number;
  riskAllowance: number;
  otherDirectCost?: number;
  markupPercent: number;
}): LandedBreakdownDisplay {
  const productCost = input.productCost;
  const deliveryCost = input.deliveryCost;
  const riskAllowance = input.riskAllowance;
  const otherDirectCost = input.otherDirectCost ?? 0;
  const landedCost =
    productCost + deliveryCost + riskAllowance + otherDirectCost;
  const priced = applyMarkupWithMarginDisplay(landedCost, input.markupPercent);
  return {
    productCost,
    deliveryCost,
    riskAllowance,
    otherDirectCost,
    ...priced,
    landedCost,
  };
}
