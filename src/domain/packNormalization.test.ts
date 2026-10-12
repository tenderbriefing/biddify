import { describe, expect, it } from "vitest";
import { normalizePackPurchase, parsePackSize } from "./packNormalization";

describe("pack normalization", () => {
  it("round-ups packs for 250 units in packs of 24", () => {
    const r = normalizePackPurchase({
      tenderQuantity: 250,
      supplierPackSize: 24,
      packPrice: 48,
      unitPrice: null,
    });
    expect(r.packsRequired).toBe(11);
    expect(r.unitsPurchased).toBe(264);
    expect(r.surplusUnits).toBe(14);
    expect(r.totalProductCost).toBe(528);
    expect(r.flag).toBe("PACK_SIZE_AMBIGUITY");
  });

  it("parses pack size from text", () => {
    expect(parsePackSize("Duracell AAA Pack of 4")).toBe(4);
  });
});
