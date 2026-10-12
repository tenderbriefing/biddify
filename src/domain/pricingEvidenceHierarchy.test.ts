import { describe, expect, it } from "vitest";
import {
  isAiEstimate,
  isStaleEvidence,
  mapLegacyQuoteEvidence,
  meetsAutoQuotedEvidenceFloor,
} from "./pricingEvidenceHierarchy";

describe("pricing evidence hierarchy", () => {
  it("maps MANUAL_ESTIMATE to AI_ESTIMATE", () => {
    expect(mapLegacyQuoteEvidence("MANUAL_ESTIMATE")).toBe("AI_ESTIMATE");
    expect(isAiEstimate("AI_ESTIMATE")).toBe(true);
  });

  it("maps Makro public reference to wholesaler web", () => {
    expect(
      mapLegacyQuoteEvidence("PUBLIC_PRICE_REFERENCE", "Makro South Africa"),
    ).toBe("WHOLESALER_WEB_PRICE");
  });

  it("treats AI estimate as never meeting auto floor", () => {
    expect(meetsAutoQuotedEvidenceFloor("AI_ESTIMATE")).toBe(false);
    expect(isStaleEvidence("AI_ESTIMATE", 0)).toBe(true);
  });

  it("flags stale public evidence", () => {
    expect(isStaleEvidence("PUBLIC_PRICE_REFERENCE", 24 * 20)).toBe(true);
    expect(isStaleEvidence("PUBLIC_PRICE_REFERENCE", 24)).toBe(false);
  });
});
