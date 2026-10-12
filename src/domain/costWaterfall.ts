/**
 * Cost waterfall — every number must reconcile exactly.
 */

import { roundMoney, toNumber } from "./money";
import { applyMarkup, calculateGrossMarginPercent, calculateGrossProfit } from "./pricing";

export type LineCostWaterfall = {
  lineNumber: number;
  observedSupplierPrice: number | null;
  supplierSellingUnit: string;
  packSize: number | null;
  packsRequired: number | null;
  unitsPurchased: number | null;
  surplusUnits: number | null;
  normalizedProductCost: number;
  deliveryAllocation: number;
  riskAllowance: number;
  otherDirectCosts: number;
  landedLineCost: number;
  markupPercent: number;
  markupAmount: number;
  sellingLineTotal: number;
  grossProfit: number;
};

export type RfqCostWaterfall = {
  lines: LineCostWaterfall[];
  productProcurement: number;
  delivery: number;
  riskAllowances: number;
  otherDirectCosts: number;
  landedCost: number;
  markupPercent: number;
  markupAmount: number;
  sellingPrice: number;
  grossProfit: number;
  grossMarginPercent: number;
  invariantsPassed: boolean;
  invariantFailures: string[];
};

export function buildLineWaterfall(input: {
  lineNumber: number;
  observedSupplierPrice: number | null;
  supplierSellingUnit: string;
  packSize: number | null;
  packsRequired: number | null;
  unitsPurchased: number | null;
  surplusUnits: number | null;
  normalizedProductCost: number;
  deliveryAllocation?: number;
  riskAllowance?: number;
  otherDirectCosts?: number;
  markupPercent: number;
}): LineCostWaterfall {
  const product = roundMoney(toNumber(input.normalizedProductCost));
  const delivery = roundMoney(toNumber(input.deliveryAllocation ?? 0));
  const risk = roundMoney(toNumber(input.riskAllowance ?? 0));
  const other = roundMoney(toNumber(input.otherDirectCosts ?? 0));
  const landed = roundMoney(product + delivery + risk + other);
  const { markupAmount, sellingPriceExVat } = applyMarkup(
    landed,
    input.markupPercent,
  );
  const gp = calculateGrossProfit(sellingPriceExVat, landed);
  return {
    lineNumber: input.lineNumber,
    observedSupplierPrice: input.observedSupplierPrice,
    supplierSellingUnit: input.supplierSellingUnit,
    packSize: input.packSize,
    packsRequired: input.packsRequired,
    unitsPurchased: input.unitsPurchased,
    surplusUnits: input.surplusUnits,
    normalizedProductCost: product,
    deliveryAllocation: delivery,
    riskAllowance: risk,
    otherDirectCosts: other,
    landedLineCost: landed,
    markupPercent: input.markupPercent,
    markupAmount,
    sellingLineTotal: sellingPriceExVat,
    grossProfit: gp,
  };
}

export function buildRfqWaterfall(
  lines: LineCostWaterfall[],
  markupPercent: number,
  extras?: { delivery?: number; riskAllowances?: number; otherDirectCosts?: number },
): RfqCostWaterfall {
  const productProcurement = roundMoney(
    lines.reduce((s, l) => s + l.normalizedProductCost, 0),
  );
  const deliveryFromLines = roundMoney(
    lines.reduce((s, l) => s + l.deliveryAllocation, 0),
  );
  const riskFromLines = roundMoney(
    lines.reduce((s, l) => s + l.riskAllowance, 0),
  );
  const otherFromLines = roundMoney(
    lines.reduce((s, l) => s + l.otherDirectCosts, 0),
  );

  const delivery = roundMoney(
    extras?.delivery != null ? extras.delivery : deliveryFromLines,
  );
  const riskAllowances = roundMoney(
    extras?.riskAllowances != null ? extras.riskAllowances : riskFromLines,
  );
  const otherDirectCosts = roundMoney(
    extras?.otherDirectCosts != null ? extras.otherDirectCosts : otherFromLines,
  );

  const landedCost = roundMoney(
    productProcurement + delivery + riskAllowances + otherDirectCosts,
  );
  const { markupAmount, sellingPriceExVat } = applyMarkup(
    landedCost,
    markupPercent,
  );
  const grossProfit = calculateGrossProfit(sellingPriceExVat, landedCost);
  const grossMarginPercent = calculateGrossMarginPercent(
    grossProfit,
    sellingPriceExVat,
  );

  const invariantFailures: string[] = [];
  const sumLineProduct = roundMoney(
    lines.reduce((s, l) => s + l.normalizedProductCost, 0),
  );
  if (sumLineProduct !== productProcurement) {
    invariantFailures.push("SUM(line procurement) ≠ product procurement total");
  }
  const recomputedLanded = roundMoney(
    productProcurement + delivery + riskAllowances + otherDirectCosts,
  );
  if (recomputedLanded !== landedCost) {
    invariantFailures.push("product+delivery+allowances+direct ≠ landed");
  }
  const recomputedSell = roundMoney(landedCost + markupAmount);
  if (recomputedSell !== sellingPriceExVat) {
    invariantFailures.push("landed + markup ≠ selling");
  }
  if (roundMoney(sellingPriceExVat - landedCost) !== grossProfit) {
    invariantFailures.push("selling - landed ≠ GP");
  }

  return {
    lines,
    productProcurement,
    delivery,
    riskAllowances,
    otherDirectCosts,
    landedCost,
    markupPercent,
    markupAmount,
    sellingPrice: sellingPriceExVat,
    grossProfit,
    grossMarginPercent,
    invariantsPassed: invariantFailures.length === 0,
    invariantFailures,
  };
}
