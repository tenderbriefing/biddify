import { describe, expect, it } from "vitest";
import {
  applyMarkupWithMarginDisplay,
  buildLandedBreakdown,
  selectMarkupPolicy,
} from "./markupPolicy";

describe("markup policy 20/25/30 (V2)", () => {
  it("applies 20% for low risk high confidence", () => {
    const r = selectMarkupPolicy({ highConfidence: true });
    expect(r.markupPercent).toBe(20);
    expect(r.band).toBe("LOW_RISK");
  });

  it("does NOT raise markup for unknown delivery", () => {
    const r = selectMarkupPolicy({
      highConfidence: true,
      deliveryUnknown: true,
    });
    expect(r.markupPercent).toBe(20);
    expect(r.reason.toLowerCase()).not.toContain("unknown delivery →");
  });

  it("applies 30% only for operational/competitive burden", () => {
    const r = selectMarkupPolicy({
      highConfidence: false,
      operationalComplexity: true,
    });
    expect(r.markupPercent).toBe(30);
  });

  it("distinguishes markup % from gross margin %", () => {
    const c = applyMarkupWithMarginDisplay(100_000, 20);
    expect(c.markupPercent).toBe(20);
    expect(c.sellingPriceExVat).toBe(120_000);
    expect(c.grossProfit).toBe(20_000);
    expect(c.grossMarginPercent).toBeCloseTo(16.67, 1);
    expect(c.markupPercent).not.toBe(c.grossMarginPercent);
  });

  it("shows risk allowance separate from markup in landed breakdown", () => {
    const b = buildLandedBreakdown({
      productCost: 1000,
      deliveryCost: 0,
      riskAllowance: 50,
      markupPercent: 25,
    });
    expect(b.landedCost).toBe(1050);
    expect(b.riskAllowance).toBe(50);
    expect(b.markupPercent).toBe(25);
    expect(b.sellingPriceExVat).toBe(1312.5);
  });
});
