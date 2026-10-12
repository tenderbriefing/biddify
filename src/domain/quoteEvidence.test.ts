import { describe, expect, it } from "vitest";
import {
  bestEvidenceType,
  evidenceLabel,
  isSupplierQuotation,
} from "./quoteEvidence";

describe("quote evidence types", () => {
  it("ranks SUPPLIER_QUOTE above PUBLIC_PRICE_REFERENCE", () => {
    expect(
      bestEvidenceType(["PUBLIC_PRICE_REFERENCE", "SUPPLIER_QUOTE"]),
    ).toBe("SUPPLIER_QUOTE");
  });

  it("does not treat public price as supplier quotation", () => {
    expect(isSupplierQuotation("PUBLIC_PRICE_REFERENCE")).toBe(false);
    expect(isSupplierQuotation("SUPPLIER_QUOTE")).toBe(true);
    expect(evidenceLabel("PUBLIC_PRICE_REFERENCE")).toMatch(/NOT a supplier/i);
  });

  it("returns UNKNOWN when no evidence", () => {
    expect(bestEvidenceType([])).toBe("UNKNOWN");
  });
});
