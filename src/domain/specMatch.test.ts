import { describe, expect, it } from "vitest";
import { evaluateSpecMatch } from "./specMatch";

describe("specification matching", () => {
  it("flags brand mismatch as NON_COMPLIANT when equivalents not allowed", () => {
    expect(
      evaluateSpecMatch({
        rfqDescription: "Size AAA battery Duracell",
        rfqBrand: "Duracell",
        equivalentAllowed: false,
        offeredDescription: "AAA alkaline battery",
        offeredBrand: "Generic",
      }),
    ).toBe("NON_COMPLIANT");
  });

  it("returns EXACT_MATCH when required brand is present", () => {
    expect(
      evaluateSpecMatch({
        rfqDescription: "Size AAA battery Duracell",
        rfqBrand: "Duracell",
        equivalentAllowed: false,
        offeredDescription: "Duracell AAA",
        offeredBrand: "Duracell",
      }),
    ).toBe("EXACT_MATCH");
  });

  it("allows POSSIBLE_MATCH when equivalents permitted and brand missing", () => {
    expect(
      evaluateSpecMatch({
        rfqDescription: "Dishwashing liquid 750ml",
        rfqBrand: "Sunlight",
        equivalentAllowed: true,
        offeredDescription: "Dishwashing liquid 750ml",
        offeredBrand: "House brand",
      }),
    ).toBe("POSSIBLE_MATCH");
  });
});
