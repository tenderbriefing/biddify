import { describe, expect, it } from "vitest";
import {
  freshnessBand,
  isUsableForAutonomousPricing,
  RESEARCH_POLICY,
} from "./researchPolicy";

describe("evidence freshness policy", () => {
  it("centralizes freshness bands", () => {
    expect(freshnessBand(3)).toBe("FRESH");
    expect(freshnessBand(10)).toBe("ACCEPTABLE");
    expect(freshnessBand(45)).toBe("STALE");
    expect(freshnessBand(120)).toBe("EXPIRED_FOR_AUTONOMOUS_PRICING");
    expect(isUsableForAutonomousPricing("STALE")).toBe(false);
    expect(RESEARCH_POLICY.budget.maxQueriesPerLine).toBeGreaterThan(0);
  });
});
