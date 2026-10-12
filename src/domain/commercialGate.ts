import type { QuoteEvidenceType } from "./quoteEvidence";

export type CommercialGateInput = {
  specificationsClear: boolean;
  lineItemsVerified: boolean;
  supplierIdentified: boolean;
  hasSupplierQuote: boolean;
  hasPriceEvidence: boolean;
  bestEvidenceType: QuoteEvidenceType;
  productsCompliant: boolean | "UNKNOWN";
  deliveryFeasible: boolean | "UNKNOWN";
  complianceFeasible: boolean | "UNKNOWN";
  workingCapitalIntensity: "LOW" | "MEDIUM" | "HIGH";
  grossProfit: number;
  grossMarginPercent: number;
  oemRequired?: boolean;
  oemObtainable?: boolean | "UNKNOWN";
  allPricesKnown: boolean;
  deliveryCostKnown: boolean;
};

export type CommercialGateResult = {
  gate: "GREEN" | "AMBER" | "RED";
  reasons: string[];
};

/**
 * GREEN requires credible evidence — public price references alone cannot earn GREEN.
 */
export function evaluateCommercialGate(
  input: CommercialGateInput,
): CommercialGateResult {
  const reasons: string[] = [];

  if (!input.lineItemsVerified) {
    reasons.push("Line items not verified against source documents");
  }
  if (!input.specificationsClear) {
    reasons.push("Specifications not yet clear / verified");
  }
  if (!input.supplierIdentified) {
    reasons.push("No supplier identified");
  }
  if (!input.allPricesKnown) {
    reasons.push("One or more unit prices UNKNOWN");
  }
  if (!input.deliveryCostKnown) {
    reasons.push("Delivery cost UNKNOWN — not assumed free");
  }
  if (input.productsCompliant === false) {
    reasons.push("Product match non-compliant");
  } else if (input.productsCompliant === "UNKNOWN") {
    reasons.push("Product match not fully verified");
  }
  if (input.deliveryFeasible === false) {
    reasons.push("Delivery not feasible");
  } else if (input.deliveryFeasible === "UNKNOWN") {
    reasons.push("Delivery feasibility unknown");
  }
  if (input.complianceFeasible === false) {
    reasons.push("Compliance not feasible");
  } else if (input.complianceFeasible === "UNKNOWN") {
    reasons.push("Compliance feasibility unknown (datasheets/MBDs/CSD)");
  }
  if (input.workingCapitalIntensity === "HIGH") {
    reasons.push("Working capital intensity HIGH");
  }
  if (input.grossProfit <= 0) {
    reasons.push("Gross profit zero or negative");
  } else if (input.grossMarginPercent < 10) {
    reasons.push(`Gross margin ${input.grossMarginPercent}% below 10%`);
  }
  if (input.oemRequired && input.oemObtainable === false) {
    reasons.push("OEM authorisation required and not obtainable — NO BID path");
  } else if (input.oemRequired && input.oemObtainable === "UNKNOWN") {
    reasons.push("OEM authorisation required — VERIFY_OEM_AUTHORIZATION");
  }

  if (input.bestEvidenceType === "PUBLIC_PRICE_REFERENCE") {
    reasons.push(
      "Pricing based on PUBLIC_PRICE_REFERENCE — not a supplier quotation",
    );
  } else if (input.bestEvidenceType === "MANUAL_ESTIMATE") {
    reasons.push("Pricing includes MANUAL_ESTIMATE evidence");
  } else if (input.bestEvidenceType === "UNKNOWN") {
    reasons.push("Price evidence type UNKNOWN");
  }

  // Hard RED
  if (
    input.grossProfit < 0 ||
    input.productsCompliant === false ||
    input.deliveryFeasible === false ||
    input.complianceFeasible === false ||
    (input.oemRequired && input.oemObtainable === false)
  ) {
    return { gate: "RED", reasons };
  }

  const greenReady =
    input.specificationsClear &&
    input.lineItemsVerified &&
    input.supplierIdentified &&
    input.hasSupplierQuote &&
    input.bestEvidenceType === "SUPPLIER_QUOTE" &&
    input.productsCompliant === true &&
    input.deliveryFeasible === true &&
    input.complianceFeasible === true &&
    input.allPricesKnown &&
    input.deliveryCostKnown &&
    input.workingCapitalIntensity !== "HIGH" &&
    input.grossProfit > 0 &&
    input.grossMarginPercent >= 12 &&
    (!input.oemRequired || input.oemObtainable === true);

  if (greenReady) {
    reasons.push(
      "Credible supplier quote, verified items, feasible delivery/compliance, acceptable profit",
    );
    return { gate: "GREEN", reasons };
  }

  if (reasons.length === 0) {
    reasons.push("Important unknowns remain — commercial review required");
  } else {
    reasons.unshift("AMBER: important unknowns or evidence gaps remain");
  }
  return { gate: "AMBER", reasons };
}
