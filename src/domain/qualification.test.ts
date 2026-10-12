import { describe, expect, it } from "vitest";
import {
  detectHardBlockersFromText,
  qualifyOpportunity,
} from "./qualification";

describe("qualification engine", () => {
  it("hard no-bids when compulsory briefing was missed", () => {
    const result = qualifyOpportunity({
      classification: "SUPPLY_AND_DELIVER",
      classificationConfidence: 0.9,
      closingAt: new Date("2026-10-20T11:00:00Z"),
      closingTimeKnown: true,
      now: new Date("2026-10-12T10:00:00Z"),
      submissionMethod: "EMAIL",
      briefingCompulsory: true,
      briefingCompulsoryKnown: true,
      briefingDate: new Date("2026-10-09T09:00:00Z"),
      briefingAttendanceEvidence: false,
      specificationClarity: "CLEAR",
      supplierFeasibility: "LIKELY",
      companyEligibility: "POTENTIALLY",
      capitalRequirement: "LOW",
      deliveryComplexity: "LOW",
      commercialPotential: "ATTRACTIVE",
    });
    expect(result.gate).toBe("RED");
    expect(result.hardNoBid).toBe(true);
    expect(result.hardNoBidCategory).toBe("BRIEFING_MISSED");
    expect(result.reasons.some((r) => /briefing/i.test(r))).toBe(true);
  });

  it("hard no-bids expired RFQs", () => {
    const result = qualifyOpportunity({
      classification: "SUPPLY_AND_DELIVER",
      classificationConfidence: 0.9,
      closingAt: new Date("2026-10-01T11:00:00Z"),
      closingTimeKnown: true,
      now: new Date("2026-10-12T10:00:00Z"),
      submissionMethod: "ETENDER",
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      specificationClarity: "CLEAR",
      supplierFeasibility: "LIKELY",
      companyEligibility: "POTENTIALLY",
      capitalRequirement: "LOW",
      deliveryComplexity: "LOW",
      commercialPotential: "ATTRACTIVE",
    });
    expect(result.gate).toBe("RED");
    expect(result.hardNoBidCategory).toBe("DEADLINE");
  });

  it("supports manual qualification override", () => {
    const result = qualifyOpportunity({
      classification: "SERVICES",
      classificationConfidence: 0.4,
      closingAt: new Date("2026-10-20T11:00:00Z"),
      closingTimeKnown: true,
      now: new Date("2026-10-12T10:00:00Z"),
      submissionMethod: "UNKNOWN",
      briefingCompulsory: false,
      briefingCompulsoryKnown: false,
      specificationClarity: "UNKNOWN",
      supplierFeasibility: "UNKNOWN",
      companyEligibility: "UNKNOWN",
      capitalRequirement: "UNKNOWN",
      deliveryComplexity: "UNKNOWN",
      commercialPotential: "UNKNOWN",
      overrideGate: "GREEN",
    });
    expect(result.gate).toBe("GREEN");
    expect(result.overridden).toBe(true);
  });

  it("detects OEM authorisation language", () => {
    const blockers = detectHardBlockersFromText(
      "Bidder must be a Manufacturer's Authorised Dealer for Dell",
    );
    expect(blockers).toContain("OEM_AUTHORISATION_REQUIRED");
  });
});
