import { describe, expect, it } from "vitest";
import { extractUsablePrice, parseZarAmount } from "./priceExtraction";

describe("price extraction", () => {
  it("parses ZAR amounts", () => {
    expect(parseZarAmount("Price R 129.99 incl VAT")).toBe(129.99);
  });

  it("rejects member and from prices", () => {
    expect(
      extractUsablePrice({
        amount: 99,
        contextText: "Member price R99",
        memberOnly: true,
      }).usableForAutonomousPricing,
    ).toBe(false);
    expect(
      extractUsablePrice({
        amount: 50,
        fromPrice: true,
        contextText: "From R50",
      }).usableForAutonomousPricing,
    ).toBe(false);
  });

  it("accepts normal VAT-inclusive price", () => {
    const r = extractUsablePrice({
      amount: 210,
      contextText: "Price R210 including VAT",
    });
    expect(r.usableForAutonomousPricing).toBe(true);
    expect(r.vatTreatment).toBe("VAT_INCLUSIVE");
    expect(r.priceType).toBe("NORMAL_PRICE");
  });

  it("flags price ranges as unusable", () => {
    const r = extractUsablePrice({
      amount: 100,
      priceRange: { min: 100, max: 400 },
    });
    expect(r.usableForAutonomousPricing).toBe(false);
    expect(r.priceType).toBe("PRICE_RANGE");
  });
});
