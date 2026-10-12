import { describe, expect, it } from "vitest";
import { calculateAcquisitionCost } from "./acquisitionCost";

describe("acquisition cost / VAT treatment", () => {
  it("absorbs VAT-inclusive supplier price for non-VAT-registered buyer", () => {
    const result = calculateAcquisitionCost({
      supplierGoodsAmount: 115_000,
      supplierVatIncluded: true,
      vatRatePercent: 15,
      biddingCompanyVatRegistered: false,
    });
    expect(result.acquisitionCost).toBe(115_000);
    expect(result.irrecoverableInputVat).toBe(15_000);
    expect(result.recoverableInputVat).toBe(0);
    expect(result.vatTreatmentKnown).toBe(true);
  });

  it("separates recoverable input VAT for VAT-registered buyer", () => {
    const result = calculateAcquisitionCost({
      supplierGoodsAmount: 115_000,
      supplierVatIncluded: true,
      vatRatePercent: 15,
      biddingCompanyVatRegistered: true,
    });
    expect(result.acquisitionCost).toBe(100_000);
    expect(result.recoverableInputVat).toBe(15_000);
    expect(result.irrecoverableInputVat).toBe(0);
  });

  it("does not invent VAT split when supplier VAT treatment is UNKNOWN", () => {
    const result = calculateAcquisitionCost({
      supplierGoodsAmount: 50_000,
      supplierVatIncluded: null,
      biddingCompanyVatRegistered: false,
    });
    expect(result.acquisitionCost).toBe(50_000);
    expect(result.vatTreatmentKnown).toBe(false);
    expect(result.irrecoverableInputVat).toBe(0);
  });
});
