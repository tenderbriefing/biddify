import { describe, expect, it } from "vitest";
import { calculatePricing } from "./pricing";
import { recommendProfitability } from "./profitability";

describe("profitability gate", () => {
  it("recommends GREEN for healthy margin without blockers", () => {
    const pricing = calculatePricing({
      supplierCost: 100_000,
      markupPercent: 20,
      vatRegistered: false,
    });
    const rec = recommendProfitability({ pricing, customerPaymentDays: 30 });
    expect(rec.gate).toBe("GREEN");
  });

  it("recommends RED when compliance is blocked", () => {
    const pricing = calculatePricing({
      supplierCost: 100_000,
      markupPercent: 20,
      vatRegistered: false,
    });
    const rec = recommendProfitability({
      pricing,
      complianceBlocked: true,
    });
    expect(rec.gate).toBe("RED");
    expect(rec.reasons.some((r) => /compliance/i.test(r))).toBe(true);
  });

  it("recommends AMBER for thin margins", () => {
    const pricing = calculatePricing({
      supplierCost: 100_000,
      markupPercent: 12,
      vatRegistered: false,
    });
    // margin = 12/112 ≈ 10.71%
    const rec = recommendProfitability({ pricing });
    expect(rec.gate).toBe("AMBER");
  });
});
