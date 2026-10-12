import { describe, expect, it } from "vitest";
import { generateProductSearchQueries } from "./searchQueryGeneration";

describe("search query generation", () => {
  it("builds multiple SA-contextual queries from attributes", () => {
    const qs = generateProductSearchQueries({
      lineNumber: 5,
      description: "Size AAA Duracell battery",
      brandRequirement: "Duracell",
      technicalSpecifications: ["1.5V", "aaa"],
    });
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.every((q) => q.query.includes("South Africa"))).toBe(true);
    expect(qs.some((q) => /Duracell/i.test(q.query))).toBe(true);
    expect(qs[0].reason.length).toBeGreaterThan(0);
    expect(qs[0].lineNumber).toBe(5);
  });
});
