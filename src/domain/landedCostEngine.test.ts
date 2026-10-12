import { describe, expect, it } from "vitest";
import { calculateLineLandedCost } from "./landedCostEngine";

describe("landed cost engine", () => {
  it("calculates product + delivery + logistics", () => {
    const r = calculateLineLandedCost({
      tenderQuantity: 10,
      unitCost: 50,
      priceKnown: true,
      deliveryKnown: true,
      deliveryCost: 100,
      logisticsCost: 25,
    });
    expect(r.productCost).toBe(500);
    expect(r.landedCost).toBe(625);
    expect(r.flags).not.toContain("UNKNOWN_DELIVERY_COST");
  });

  it("flags unknown delivery and does not treat as free", () => {
    const r = calculateLineLandedCost({
      tenderQuantity: 10,
      unitCost: 50,
      priceKnown: true,
      deliveryKnown: false,
    });
    expect(r.flags).toContain("UNKNOWN_DELIVERY_COST");
    expect(r.delivery).toBe(0);
  });

  it("prevents pack-size errors", () => {
    const r = calculateLineLandedCost({
      tenderQuantity: 100,
      unitCost: 10,
      priceKnown: true,
      supplierPackSize: 10,
      packPrice: 80,
      deliveryKnown: true,
      deliveryCost: 0,
    });
    expect(r.packsRequired).toBe(10);
    expect(r.productCost).toBe(800);
  });

  it("marks unresolved when no price", () => {
    const r = calculateLineLandedCost({
      tenderQuantity: 5,
      unitCost: null,
      priceKnown: false,
    });
    expect(r.unresolved).toBe(true);
  });
});
