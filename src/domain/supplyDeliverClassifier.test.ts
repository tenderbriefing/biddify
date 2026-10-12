import { describe, expect, it } from "vitest";
import { classifySupplyAndDeliver } from "./supplyDeliverClassifier";

describe("supply & deliver classifier", () => {
  it("classifies clear supply and deliver as auto-proceed", () => {
    const r = classifySupplyAndDeliver({
      title: "Supply and deliver dishwashing liquid and batteries",
      description: "Goods for Johannesburg Water",
      category: "goods",
      boqLineCount: 5,
      hasPricingSchedule: true,
    });
    expect(r.classification).toBe("SUPPLY_AND_DELIVER");
    expect(r.proceedsAutomatically).toBe(true);
  });

  it("excludes construction", () => {
    const r = classifySupplyAndDeliver({
      title: "CIDB graded construction works at depot",
      description: "Building works renovation",
    });
    expect(r.classification).toBe("CONSTRUCTION");
    expect(r.proceedsAutomatically).toBe(false);
  });

  it("excludes services", () => {
    const r = classifySupplyAndDeliver({
      title: "Appointment of a service provider for maintenance",
      description: "Provision of services",
      mainProcurementCategory: "services",
    });
    expect(r.classification).toBe("SERVICES");
    expect(r.proceedsAutomatically).toBe(false);
  });

  it("marks mixed supply+install for review", () => {
    const r = classifySupplyAndDeliver({
      title: "Supply and install laboratory equipment",
      description: "Goods and commissioning",
      boqLineCount: 3,
    });
    expect(r.classification).toBe("MIXED");
    expect(r.proceedsAutomatically).toBe(false);
  });
});
