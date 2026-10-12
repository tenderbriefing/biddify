import { describe, expect, it } from "vitest";
import {
  assessDeliveryMateriality,
  deliveryRiskAllowance,
  extractDeliveryFromText,
} from "./deliveryEvidence";

describe("delivery evidence", () => {
  it("extracts free and fixed delivery", () => {
    expect(extractDeliveryFromText("Free delivery on all orders").type).toBe(
      "FREE_DELIVERY",
    );
    expect(
      extractDeliveryFromText("Delivery fee R99 to major centres").amount,
    ).toBe(99);
  });

  it("never treats unknown delivery as R0 cost via allowance on material lines", () => {
    const d = extractDeliveryFromText("No shipping info");
    expect(d.type).toBe("UNKNOWN_DELIVERY");
    expect(d.known).toBe(false);
    const material = assessDeliveryMateriality(20_000, d);
    expect(material.band).toBe("MATERIAL");
    const allowance = deliveryRiskAllowance(20_000, d);
    expect(allowance.apply).toBe(false);
  });
});
