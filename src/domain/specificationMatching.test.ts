import { describe, expect, it } from "vitest";
import { matchSpecification, mayAutoSelect } from "./specificationMatching";

describe("specification matching engine", () => {
  it("returns EXACT_MATCH for aligned brand and size", () => {
    const r = matchSpecification({
      requiredDescription: "Size AAA Duracell battery",
      requiredBrand: "Duracell",
      equivalentAllowed: false,
      candidateDescription: "Duracell AAA alkaline battery 1.5V",
      candidateBrand: "Duracell",
    });
    expect(r.verdict).toBe("EXACT_MATCH");
    expect(mayAutoSelect(r.verdict)).toBe(true);
  });

  it("returns MISMATCH on brand conflict when equivalents disallowed", () => {
    const r = matchSpecification({
      requiredDescription: "Size AAA Duracell battery",
      requiredBrand: "Duracell",
      equivalentAllowed: false,
      candidateDescription: "Energizer AAA battery",
      candidateBrand: "Energizer",
    });
    expect(r.verdict).toBe("MISMATCH");
    expect(mayAutoSelect(r.verdict)).toBe(false);
  });

  it("allows ACCEPTABLE_EQUIVALENT when policy permits", () => {
    const r = matchSpecification({
      requiredDescription: "DISHWASHING LIQUID 750ML",
      requiredBrand: "Sunlight",
      equivalentAllowed: true,
      candidateDescription: "Dishwashing liquid 750ml lemon",
      candidateBrand: "House brand",
    });
    expect(r.verdict).toBe("ACCEPTABLE_EQUIVALENT");
  });

  it("flags size conflicts as MISMATCH", () => {
    const r = matchSpecification({
      requiredDescription: "Cotton Wool Roll 500g",
      equivalentAllowed: true,
      candidateDescription: "Cotton wool roll 100g",
      candidateBrand: null,
    });
    expect(r.verdict).toBe("MISMATCH");
  });

  it("returns INSUFFICIENT_INFORMATION when little overlap", () => {
    const r = matchSpecification({
      requiredDescription: "TOOL BATTERY GENERAL PURPOSE PENLIGHT 1.5 VOLT SIZE AA",
      equivalentAllowed: true,
      candidateDescription: "Office chair mesh",
      candidateBrand: null,
    });
    expect(r.verdict).toBe("INSUFFICIENT_INFORMATION");
    expect(mayAutoSelect(r.verdict)).toBe(false);
  });
});
