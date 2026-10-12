import { describe, expect, it } from "vitest";
import { interpretBrandRequirement } from "./brandRules";

describe("brand rules", () => {
  it("treats bare Duracell as mandatory", () => {
    const r = interpretBrandRequirement({
      description: "Size AAA Duracell battery",
      brandRequirement: "Duracell",
      equivalentAllowedFlag: false,
    });
    expect(r.rule).toBe("MANDATORY_BRAND");
    expect(r.equivalentAllowed).toBe(false);
  });

  it("allows brand or equivalent language", () => {
    const r = interpretBrandRequirement({
      description: "Duracell or equivalent AAA battery",
      brandRequirement: "Duracell",
    });
    expect(r.rule).toBe("BRAND_OR_EQUIVALENT");
    expect(r.equivalentAllowed).toBe(true);
  });
});
