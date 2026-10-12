import { describe, expect, it } from "vitest";
import { buildFounderReviewPack } from "./founderReviewPack";

describe("founder review pack", () => {
  it("answers the 12 operating questions without fabricating SENT email", () => {
    const pack = buildFounderReviewPack({
      internalId: "BID-000011",
      title: "Consumables supply",
      buyer: "Johannesburg Water",
      closingDisplay: "2026-10-16 14:00 SAST",
      hoursRemaining: 48,
      isClosed: false,
      classification: "SUPPLY_AND_DELIVER",
      eligibilityVerdict: "ELIGIBLE_WITH_WARNING",
      eligibilityExplanation: "CSD commodity mismatch",
      selectedCompanyName: "Orison Chemicals",
      lineItems: [
        {
          lineNumber: 5,
          description: "Size AAA Duracell battery",
          quantity: 150,
          unit: "EA",
          brandRequirement: "Duracell",
        },
      ],
      suppliers: [
        {
          name: "Erom Wholesalers",
          email: "sales@erom.co.za",
          lifecycleStatus: "PENDING_EMAIL_INTEGRATION",
        },
      ],
      landedCost: 100,
      sellingPrice: 120,
      grossProfit: 20,
      grossMarginPercent: 16.67,
      markupPercent: 20,
      vatRegistered: false,
      evidenceQuality: "PUBLIC_PRICE_REFERENCE",
      complianceBlocking: ["Complete MBD forms"],
      complianceComplete: ["CSD registration report"],
      nextAction: "FOUNDERS_REVIEW",
      nextActionReason: "Open for Founder",
      pipelineStatus: "FOUNDER_REVIEW",
      emailTransport: "PENDING_EMAIL_INTEGRATION",
    });

    expect(pack.questions).toHaveLength(12);
    expect(pack.readyToSubmit).toBe(false);
    expect(pack.readyForFounderReview).toBe(true);
    expect(pack.questions[5]?.answer).toMatch(/PENDING_EMAIL_INTEGRATION/);
    expect(pack.questions[5]?.answer).not.toMatch(/\bSENT\b/);
    expect(pack.questions[8]?.answer).toMatch(/16\.67/);
    expect(pack.questions[8]?.answer).toMatch(/margin ≠ markup/i);
  });
});
