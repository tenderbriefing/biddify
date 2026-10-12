import { describe, expect, it } from "vitest";
import { scoreOpportunity } from "./opportunityScore";

describe("opportunity score", () => {
  it("scores supply-and-deliver higher and keeps commercial neutral without pricing", () => {
    const result = scoreOpportunity({
      classification: "SUPPLY_AND_DELIVER",
      classificationConfidence: 0.9,
      closingAt: new Date("2026-10-25T11:00:00Z"),
      closingTimeKnown: true,
      now: new Date("2026-10-12T10:00:00Z"),
      specificationClarity: "CLEAR",
      complianceFeasibility: "MEDIUM",
      supplierFeasibility: "LIKELY",
      deliveryComplexity: "LOW",
      submissionMethod: "ETENDER",
      capitalRequirement: "LOW",
      hasSupplierPricing: false,
    });
    expect(result.total).toBeGreaterThan(60);
    const commercial = result.components.find((c) => c.key === "commercial");
    expect(commercial?.weight).toBe(0);
  });
});
