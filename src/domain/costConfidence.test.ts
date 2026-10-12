import { describe, expect, it } from "vitest";
import {
  calculateCostConfidence,
  calculateSpecConfidence,
} from "./costConfidence";

describe("cost / specification confidence", () => {
  it("scores formal supplier quote highest", () => {
    const result = calculateCostConfidence({
      evidenceTypes: ["SUPPLIER_QUOTE"],
      independentSupplierCount: 2,
      quoteAgeDays: 3,
      specMatchKnown: true,
      stockConfirmed: true,
      deliveryConfirmed: true,
      vatClarity: true,
      leadTimeClarity: true,
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("keeps public pricing from normal GREEN-level confidence alone", () => {
    const result = calculateCostConfidence({
      evidenceTypes: ["PUBLIC_PRICE_REFERENCE"],
      independentSupplierCount: 1,
      quoteAgeDays: 1,
      specMatchKnown: false,
      stockConfirmed: false,
      deliveryConfirmed: false,
      vatClarity: false,
      leadTimeClarity: false,
    });
    expect(result.score).toBeLessThan(70);
    expect(result.reasons.some((r) => /Public\/manual/i.test(r))).toBe(true);
  });

  it("zeros spec confidence on NON_COMPLIANT", () => {
    expect(
      calculateSpecConfidence({
        matches: ["EXACT_MATCH", "NON_COMPLIANT"],
      }).score,
    ).toBe(0);
  });
});
