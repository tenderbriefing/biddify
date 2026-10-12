import { describe, expect, it } from "vitest";
import { classifyOpportunity } from "./classification";

describe("classification", () => {
  it("classifies supply and deliver goods", () => {
    const result = classifyOpportunity({
      title: "COM133/2026",
      description: "Supply and Deliver Consumables as per RFQ",
      mainProcurementCategory: "goods",
      procurementMethod: "Request for Quotation",
    });
    expect(result.effective).toBe("SUPPLY_AND_DELIVER");
    expect(result.confidence).toBeGreaterThan(0.6);
    expect(result.source).toBe("HEURISTIC");
  });

  it("respects manual override without hiding heuristic", () => {
    const result = classifyOpportunity(
      {
        title: "Supply and Deliver Stationery",
        description: "office supplies",
        mainProcurementCategory: "goods",
      },
      "SERVICES",
    );
    expect(result.classification).toBe("SUPPLY_AND_DELIVER");
    expect(result.effective).toBe("SERVICES");
    expect(result.source).toBe("MANUAL");
    expect(result.reasoning).toMatch(/Manual override/);
  });
});
