import { describe, expect, it } from "vitest";
import {
  applyMarkupWithMarginDisplay,
  selectMarkupPolicy,
} from "./markupPolicy";

describe("markup policy 20/25/30", () => {
  it("applies 20% for low risk high confidence", () => {
    const r = selectMarkupPolicy({ highConfidence: true });
    expect(r.markupPercent).toBe(20);
    expect(r.band).toBe("LOW_RISK");
  });

  it("applies 25% for normal", () => {
    const r = selectMarkupPolicy({
      highConfidence: false,
      deliveryUnknown: true,
    });
    expect(r.markupPercent).toBe(25);
  });

  it("applies 30% for higher risk", () => {
    const r = selectMarkupPolicy({
      highConfidence: false,
      evidenceWeak: true,
      deliveryUnknown: true,
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
});
