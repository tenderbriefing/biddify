import { describe, expect, it } from "vitest";
import {
  detectInternalDataLeakage,
  generateCustomerQuotation,
} from "./quotationGeneration";

describe("quotation generation", () => {
  it("calculates line totals and VAT correctly", () => {
    const q = generateCustomerQuotation({
      rfqReference: "RFQ-1",
      institution: "Test Buyer",
      quotationNumber: "AQ-1",
      quotationDate: new Date("2026-10-12"),
      company: {
        legalName: "ORISON CHEMICALS",
        vatRegistered: true,
      },
      lines: [
        {
          lineNumber: 1,
          description: "Item A",
          quantity: 10,
          unit: "EA",
          unitSellingPrice: 100,
        },
      ],
      deliveryAmount: 50,
    });
    expect(q.subtotal).toBe(1000);
    expect(q.delivery).toBe(50);
    expect(q.vatAmount).toBeCloseTo(157.5, 1);
    expect(q.total).toBeCloseTo(1207.5, 1);
  });

  it("does not leak internal commercial fields", () => {
    const q = generateCustomerQuotation({
      rfqReference: "RFQ-1",
      institution: "Test Buyer",
      quotationNumber: "AQ-1",
      quotationDate: new Date("2026-10-12"),
      company: { legalName: "ORISON CHEMICALS", vatRegistered: false },
      lines: [
        {
          lineNumber: 1,
          description: "Item A",
          quantity: 1,
          unit: "EA",
          unitSellingPrice: 200,
        },
      ],
    });
    const leaks = detectInternalDataLeakage(q);
    expect(leaks).not.toContain("markup");
    expect(leaks).not.toContain("supplierCost");
    expect(leaks).not.toContain("confidence");
    expect(leaks).not.toContain("url");
  });
});
