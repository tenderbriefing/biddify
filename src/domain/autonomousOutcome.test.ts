import { describe, expect, it } from "vitest";
import { classifyAutonomousOutcome } from "./autonomousOutcome";

const baseLine = {
  lineNumber: 1,
  unresolved: false,
  matchVerdict: "EXACT_MATCH" as const,
  evidenceLevel: "WHOLESALER_WEB_PRICE" as const,
  evidenceAgeHours: 24,
  flags: [] as string[],
};

describe("autonomous outcome thresholds", () => {
  it("AUTO_QUOTED when guardrails clear", () => {
    const r = classifyAutonomousOutcome({
      eligibility: "ELIGIBLE",
      compulsoryBriefingMissed: false,
      closingDeadlinePassed: false,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: [baseLine],
      confidence: 0.85,
    });
    expect(r.outcome).toBe("AUTO_QUOTED");
  });

  it("REVIEW_REQUIRED on weak evidence / delivery unknown", () => {
    const r = classifyAutonomousOutcome({
      eligibility: "ELIGIBLE",
      compulsoryBriefingMissed: false,
      closingDeadlinePassed: false,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: [
        {
          ...baseLine,
          flags: ["UNKNOWN_DELIVERY_COST"],
          evidenceLevel: "PUBLIC_PRICE_REFERENCE",
        },
      ],
      confidence: 0.75,
    });
    expect(r.outcome).toBe("REVIEW_REQUIRED");
  });

  it("UNPRICEABLE when all lines unresolved", () => {
    const r = classifyAutonomousOutcome({
      eligibility: "ELIGIBLE",
      compulsoryBriefingMissed: false,
      closingDeadlinePassed: false,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: [{ ...baseLine, unresolved: true, matchVerdict: null, evidenceLevel: null }],
      confidence: 0.4,
    });
    expect(r.outcome).toBe("UNPRICEABLE");
  });

  it("INELIGIBLE when company blocked", () => {
    const r = classifyAutonomousOutcome({
      eligibility: "NOT_ELIGIBLE",
      compulsoryBriefingMissed: false,
      closingDeadlinePassed: false,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: [baseLine],
      confidence: 0.9,
    });
    expect(r.outcome).toBe("INELIGIBLE");
  });

  it("REVIEW_REQUIRED on MISMATCH", () => {
    const r = classifyAutonomousOutcome({
      eligibility: "ELIGIBLE",
      compulsoryBriefingMissed: false,
      closingDeadlinePassed: false,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: [{ ...baseLine, matchVerdict: "MISMATCH" }],
      confidence: 0.8,
    });
    expect(r.outcome).toBe("REVIEW_REQUIRED");
  });
});
