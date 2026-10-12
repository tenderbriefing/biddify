import { describe, expect, it } from "vitest";
import {
  buildComparisonRows,
  calculateSplitSourceGoodsCost,
  recommendOffer,
} from "./quoteComparison";

describe("quote comparison / split sourcing", () => {
  it("never recommends NON_COMPLIANT over a compliant match", () => {
    const rec = recommendOffer([
      {
        supplierId: "cheap",
        supplierName: "Cheap",
        unitCost: 10,
        lineTotal: 100,
        deliveryCost: null,
        deliveryKnown: false,
        leadTimeDays: 2,
        matchState: "NON_COMPLIANT",
        evidenceType: "SUPPLIER_QUOTE",
        quoteLineId: "1",
      },
      {
        supplierId: "good",
        supplierName: "Good",
        unitCost: 15,
        lineTotal: 150,
        deliveryCost: 50,
        deliveryKnown: true,
        leadTimeDays: 5,
        matchState: "COMPLIANT_EQUIVALENT",
        evidenceType: "SUPPLIER_QUOTE",
        quoteLineId: "2",
      },
    ]);
    expect(rec.supplierId).toBe("good");
  });

  it("supports split sourcing across suppliers", () => {
    const cost = calculateSplitSourceGoodsCost([
      { quantity: 10, unitCost: 20 },
      { quantity: 5, unitCost: 40 },
    ]);
    expect(cost).toBe(400);
  });

  it("returns null when any split-source price is UNKNOWN", () => {
    expect(
      calculateSplitSourceGoodsCost([
        { quantity: 10, unitCost: 20 },
        { quantity: 5, unitCost: null },
      ]),
    ).toBeNull();
  });

  it("builds comparison rows with recommendations", () => {
    const rows = buildComparisonRows([
      {
        rfqLineItemId: "li1",
        description: "Paper towel",
        quantity: 10,
        specification: "280mm x 1500m",
        offers: [
          {
            supplierId: "a",
            supplierName: "A",
            unitCost: 200,
            lineTotal: 2000,
            deliveryCost: null,
            deliveryKnown: false,
            leadTimeDays: 3,
            matchState: "EXACT_MATCH",
            evidenceType: "SUPPLIER_QUOTE",
            quoteLineId: "q1",
          },
        ],
      },
    ]);
    expect(rows[0]!.recommendedSupplierId).toBe("a");
  });
});
