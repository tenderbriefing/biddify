import { describe, expect, it } from "vitest";
import { calculateWorkingCapital } from "./workingCapital";

describe("working capital", () => {
  it("reflects upfront cash and recovery period", () => {
    const result = calculateWorkingCapital({
      upfrontSupplierCash: 250_000,
      otherUpfrontCosts: 15_000,
      expectedRecoveryDays: 30,
      supplierPaymentTerms: "100% upfront",
      buyerPaymentTerms: "30 days after delivery",
    });
    expect(result.upfrontCashRequired).toBe(265_000);
    expect(result.expectedRecoveryDays).toBe(30);
    expect(result.intensity).toBe("HIGH");
    expect(result.supplierPaymentTerms).toBe("100% upfront");
    expect(result.buyerPaymentTerms).toBe("30 days after delivery");
  });

  it("classifies medium intensity for moderate exposure", () => {
    const result = calculateWorkingCapital({
      upfrontSupplierCash: 60_000,
      expectedRecoveryDays: 14,
      supplierPaymentTerms: "COD",
      buyerPaymentTerms: "14 days",
    });
    expect(result.intensity).toBe("MEDIUM");
  });
});
