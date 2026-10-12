import { describe, expect, it } from "vitest";
import { normalizeBoqLine, requiredPacks } from "./boqNormalization";

describe("BOQ normalization", () => {
  it("preserves original wording separately", () => {
    const n = normalizeBoqLine({
      lineNumber: 1,
      description: "DISHWASHING LIQUID 750ML",
      quantity: 60,
      unit: "EA",
    });
    expect(n.originalWording).toBe("DISHWASHING LIQUID 750ML");
    expect(n.technicalSpecifications.some((t) => t.includes("750"))).toBe(true);
  });

  it("extracts brand requirements", () => {
    const n = normalizeBoqLine({
      lineNumber: 5,
      description: "Size AAA Duracell battery",
      brandRequirement: "Duracell",
      quantity: 150,
      unit: "EA",
    });
    expect(n.brandRequirement).toBe("Duracell");
  });
});

describe("pack-size calculations", () => {
  it("requires 10 packs for 100 units sold in 10s", () => {
    const r = requiredPacks(100, 10);
    expect(r.packs).toBe(10);
    expect(r.exact).toBe(true);
    expect(r.flag).toBe("OK");
  });

  it("flags ambiguity when overbuy needed", () => {
    const r = requiredPacks(25, 10);
    expect(r.packs).toBe(3);
    expect(r.remainder).toBe(5);
    expect(r.flag).toBe("PACK_SIZE_AMBIGUITY");
  });
});
