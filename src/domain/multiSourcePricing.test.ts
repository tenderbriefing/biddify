import { describe, expect, it } from "vitest";
import { validateMultiSourcePrices } from "./multiSourcePricing";

describe("multi-source pricing", () => {
  it("detects outliers and does not auto-pick cheapest", () => {
    const r = validateMultiSourcePrices([
      { id: "a", price: 899, sourceQuality: 0.8, matchSelectable: true, freshnessOk: true, packResolved: true },
      { id: "b", price: 920, sourceQuality: 0.8, matchSelectable: true, freshnessOk: true, packResolved: true },
      { id: "c", price: 935, sourceQuality: 0.75, matchSelectable: true, freshnessOk: true, packResolved: true },
      { id: "d", price: 299, sourceQuality: 0.5, matchSelectable: true, freshnessOk: true, packResolved: true },
    ]);
    expect(r.flags).toContain("PRICE_OUTLIER");
    expect(r.selectedId).not.toBe("d");
    expect(r.count).toBeGreaterThanOrEqual(3);
  });

  it("flags single source", () => {
    const r = validateMultiSourcePrices([
      { id: "a", price: 100, sourceQuality: 0.9, matchSelectable: true, freshnessOk: true, packResolved: true },
    ]);
    expect(r.flags).toContain("SINGLE_SOURCE_PRICE");
  });
});
