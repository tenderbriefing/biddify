import { describe, expect, it } from "vitest";
import { evaluateCommercialGate } from "./commercialGate";

const baseGreen = {
  specificationsClear: true,
  lineItemsVerified: true,
  supplierIdentified: true,
  hasSupplierQuote: true,
  hasPriceEvidence: true,
  bestEvidenceType: "SUPPLIER_QUOTE" as const,
  productsCompliant: true as const,
  deliveryFeasible: true as const,
  complianceFeasible: true as const,
  workingCapitalIntensity: "LOW" as const,
  grossProfit: 20_000,
  grossMarginPercent: 16.67,
  allPricesKnown: true,
  deliveryCostKnown: true,
};

describe("commercial profitability gate", () => {
  it("can produce GREEN with credible supplier quote evidence", () => {
    const result = evaluateCommercialGate(baseGreen);
    expect(result.gate).toBe("GREEN");
  });

  it("stays AMBER when only PUBLIC_PRICE_REFERENCE evidence exists", () => {
    const result = evaluateCommercialGate({
      ...baseGreen,
      hasSupplierQuote: false,
      bestEvidenceType: "PUBLIC_PRICE_REFERENCE",
      productsCompliant: "UNKNOWN",
      deliveryFeasible: "UNKNOWN",
      complianceFeasible: "UNKNOWN",
    });
    expect(result.gate).toBe("AMBER");
    expect(result.reasons.some((r) => /PUBLIC_PRICE_REFERENCE/.test(r))).toBe(
      true,
    );
  });

  it("produces RED on objective commercial failure", () => {
    const result = evaluateCommercialGate({
      ...baseGreen,
      grossProfit: -500,
      productsCompliant: false,
    });
    expect(result.gate).toBe("RED");
  });

  it("OEM required with unknown authorisation is AMBER not automatic NO BID", () => {
    const result = evaluateCommercialGate({
      ...baseGreen,
      hasSupplierQuote: false,
      bestEvidenceType: "PUBLIC_PRICE_REFERENCE",
      oemRequired: true,
      oemObtainable: "UNKNOWN",
      productsCompliant: "UNKNOWN",
      deliveryFeasible: "UNKNOWN",
      complianceFeasible: "UNKNOWN",
    });
    expect(result.gate).toBe("AMBER");
    expect(
      result.reasons.some((r) => /VERIFY_OEM_AUTHORIZATION/.test(r)),
    ).toBe(true);
  });

  it("OEM required and not obtainable is RED", () => {
    const result = evaluateCommercialGate({
      ...baseGreen,
      oemRequired: true,
      oemObtainable: false,
    });
    expect(result.gate).toBe("RED");
  });
});
