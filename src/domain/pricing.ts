import { roundMoney, toNumber } from "./money";

/**
 * Commercial pricing engine.
 *
 * Markup ≠ margin.
 * Example: cost 100_000, markup 20% → selling 120_000, GP 20_000, margin 16.67%.
 *
 * VAT is NEVER inferred. Caller must pass company.vatRegistered explicitly.
 */

export type PricingCostInputs = {
  supplierCost: number;
  delivery?: number;
  logistics?: number;
  packaging?: number;
  insurance?: number;
  financing?: number;
  contingency?: number;
  otherDirectCosts?: number;
};

export type PricingInputs = PricingCostInputs & {
  markupPercent: number;
  vatRegistered: boolean;
  vatRatePercent?: number;
  /** Cash required before customer payment (e.g. supplier upfront). */
  workingCapitalRequired?: number;
};

export type PricingResult = {
  supplierCost: number;
  delivery: number;
  logistics: number;
  packaging: number;
  insurance: number;
  financing: number;
  contingency: number;
  otherDirectCosts: number;
  landedCost: number;
  markupPercent: number;
  markupAmount: number;
  sellingPriceExVat: number;
  vatRegistered: boolean;
  vatRatePercent: number;
  vatAmount: number;
  totalQuotation: number;
  grossProfit: number;
  grossMarginPercent: number;
  workingCapitalRequired: number;
};

export type LinePricingInput = {
  quantity: number;
  unitCost: number;
};

export type LinePricingResult = {
  quantity: number;
  unitCost: number;
  lineCost: number;
  unitSell: number;
  lineSell: number;
};

const DEFAULT_VAT_RATE = 15;

export function calculateLandedCost(inputs: PricingCostInputs): number {
  const supplierCost = roundMoney(toNumber(inputs.supplierCost));
  const delivery = roundMoney(toNumber(inputs.delivery ?? 0));
  const logistics = roundMoney(toNumber(inputs.logistics ?? 0));
  const packaging = roundMoney(toNumber(inputs.packaging ?? 0));
  const insurance = roundMoney(toNumber(inputs.insurance ?? 0));
  const financing = roundMoney(toNumber(inputs.financing ?? 0));
  const contingency = roundMoney(toNumber(inputs.contingency ?? 0));
  const otherDirectCosts = roundMoney(toNumber(inputs.otherDirectCosts ?? 0));

  return roundMoney(
    supplierCost +
      delivery +
      logistics +
      packaging +
      insurance +
      financing +
      contingency +
      otherDirectCosts,
  );
}

/** Selling price from cost and markup %. Markup is on cost, not margin. */
export function applyMarkup(landedCost: number, markupPercent: number): {
  markupAmount: number;
  sellingPriceExVat: number;
} {
  const cost = roundMoney(toNumber(landedCost));
  const markup = toNumber(markupPercent);
  if (markup < 0) {
    throw new Error("Markup percent cannot be negative");
  }
  const markupAmount = roundMoney(cost * (markup / 100));
  const sellingPriceExVat = roundMoney(cost + markupAmount);
  return { markupAmount, sellingPriceExVat };
}

export function calculateGrossProfit(
  sellingPriceExVat: number,
  landedCost: number,
): number {
  return roundMoney(toNumber(sellingPriceExVat) - toNumber(landedCost));
}

/** Gross margin % = GP / selling price (ex VAT). Not the same as markup. */
export function calculateGrossMarginPercent(
  grossProfit: number,
  sellingPriceExVat: number,
): number {
  const sell = toNumber(sellingPriceExVat);
  if (sell === 0) {
    return 0;
  }
  return roundMoney((toNumber(grossProfit) / sell) * 100);
}

/**
 * VAT treatment from company VAT status only.
 * If not VAT registered: vatAmount = 0, total = sellingPriceExVat.
 * If VAT registered: apply configured rate to selling price ex VAT.
 */
export function applyVatTreatment(
  sellingPriceExVat: number,
  vatRegistered: boolean,
  vatRatePercent: number = DEFAULT_VAT_RATE,
): { vatAmount: number; totalQuotation: number } {
  const sell = roundMoney(toNumber(sellingPriceExVat));
  if (vatRegistered !== true && vatRegistered !== false) {
    throw new Error("VAT status must be explicitly true or false");
  }
  if (!vatRegistered) {
    return { vatAmount: 0, totalQuotation: sell };
  }
  const rate = toNumber(vatRatePercent);
  if (rate < 0) {
    throw new Error("VAT rate cannot be negative");
  }
  const vatAmount = roundMoney(sell * (rate / 100));
  return { vatAmount, totalQuotation: roundMoney(sell + vatAmount) };
}

export function priceLineItem(
  input: LinePricingInput,
  markupPercent: number,
): LinePricingResult {
  const quantity = toNumber(input.quantity);
  const unitCost = roundMoney(toNumber(input.unitCost));
  if (quantity < 0) {
    throw new Error("Quantity cannot be negative");
  }
  const lineCost = roundMoney(quantity * unitCost);
  const { sellingPriceExVat: lineSell } = applyMarkup(lineCost, markupPercent);
  const unitSell =
    quantity === 0 ? 0 : roundMoney(lineSell / quantity);
  return { quantity, unitCost, lineCost, unitSell, lineSell };
}

export function calculatePricing(inputs: PricingInputs): PricingResult {
  const supplierCost = roundMoney(toNumber(inputs.supplierCost));
  const delivery = roundMoney(toNumber(inputs.delivery ?? 0));
  const logistics = roundMoney(toNumber(inputs.logistics ?? 0));
  const packaging = roundMoney(toNumber(inputs.packaging ?? 0));
  const insurance = roundMoney(toNumber(inputs.insurance ?? 0));
  const financing = roundMoney(toNumber(inputs.financing ?? 0));
  const contingency = roundMoney(toNumber(inputs.contingency ?? 0));
  const otherDirectCosts = roundMoney(toNumber(inputs.otherDirectCosts ?? 0));
  const markupPercent = toNumber(inputs.markupPercent);
  const vatRatePercent = toNumber(inputs.vatRatePercent ?? DEFAULT_VAT_RATE);
  const workingCapitalRequired = roundMoney(
    toNumber(inputs.workingCapitalRequired ?? supplierCost),
  );

  const landedCost = calculateLandedCost({
    supplierCost,
    delivery,
    logistics,
    packaging,
    insurance,
    financing,
    contingency,
    otherDirectCosts,
  });

  const { markupAmount, sellingPriceExVat } = applyMarkup(
    landedCost,
    markupPercent,
  );
  const grossProfit = calculateGrossProfit(sellingPriceExVat, landedCost);
  const grossMarginPercent = calculateGrossMarginPercent(
    grossProfit,
    sellingPriceExVat,
  );
  const { vatAmount, totalQuotation } = applyVatTreatment(
    sellingPriceExVat,
    inputs.vatRegistered,
    vatRatePercent,
  );

  return {
    supplierCost,
    delivery,
    logistics,
    packaging,
    insurance,
    financing,
    contingency,
    otherDirectCosts,
    landedCost,
    markupPercent,
    markupAmount,
    sellingPriceExVat,
    vatRegistered: inputs.vatRegistered,
    vatRatePercent,
    vatAmount,
    totalQuotation,
    grossProfit,
    grossMarginPercent,
    workingCapitalRequired,
  };
}
