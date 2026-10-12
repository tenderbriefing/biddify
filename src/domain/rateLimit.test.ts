import { describe, expect, it } from "vitest";
import { evaluateRateLimits } from "./rateLimit";
import { decideFollowUp, shouldStopSourcing } from "./followUp";
import { calculateCapitalEfficiency, calculateBidPriority } from "./bidPriority";
import { evaluateCapitalControls } from "./capitalControls";
import { calculateSupplierScore } from "./supplierScore";
import { classifySupplierReply } from "./responseClassification";

describe("rate limit / follow-up / capital / supplier score", () => {
  it("enforces rate limits and cooldown", () => {
    const blocked = evaluateRateLimits(
      {
        maxPerHour: 10,
        maxPerDay: 40,
        maxPerSupplierPerDay: 2,
        maxPerCompanyPerDay: 20,
        cooldownHours: 72,
      },
      {
        sentLastHour: 10,
        sentLastDay: 5,
        sentToSupplierLastDay: 0,
        sentByCompanyLastDay: 0,
        hoursSinceSupplierContact: 1,
      },
    );
    expect(blocked.allowed).toBe(false);
  });

  it("cancels follow-ups after supplier response", () => {
    expect(
      decideFollowUp({
        followUpCount: 0,
        maxFollowUps: 2,
        supplierResponded: true,
        hoursSinceLastContact: 100,
        hoursToClose: 72,
        quotesAlreadyObtained: 0,
        sourcingStopped: false,
      }).shouldFollowUp,
    ).toBe(false);
  });

  it("stops at max follow-ups", () => {
    expect(
      decideFollowUp({
        followUpCount: 2,
        maxFollowUps: 2,
        supplierResponded: false,
        hoursSinceLastContact: 100,
        hoursToClose: 72,
        quotesAlreadyObtained: 0,
        sourcingStopped: false,
      }).shouldFollowUp,
    ).toBe(false);
  });

  it("stops sourcing when confidence sufficient", () => {
    expect(
      shouldStopSourcing({
        compliantQuoteCount: 2,
        costConfidence: 80,
        deliveryConfirmed: true,
        specConfidence: 80,
        hoursToClose: 100,
      }).stop,
    ).toBe(true);
  });

  it("flags FUNDING REQUIRED without auto-reject", () => {
    const result = evaluateCapitalControls({
      totalLimit: 100_000,
      companyLimit: null,
      capitalCommitted: 50_000,
      capitalPotentialApproved: 40_000,
      capitalRequested: 30_000,
    });
    expect(result.fundingRequired).toBe(true);
    expect(result.reasons.some((r) => /FUNDING REQUIRED/i.test(r))).toBe(true);
  });

  it("prefers capital-efficient bids in priority math", () => {
    const a = calculateCapitalEfficiency(20_000, 300_000)!;
    const b = calculateCapitalEfficiency(18_000, 80_000)!;
    expect(b).toBeGreaterThan(a);
    const p = calculateBidPriority({
      expectedGrossProfit: 18_000,
      grossMarginPercent: 16,
      workingCapitalRequired: 80_000,
      costConfidence: 70,
      specConfidence: 70,
      hoursToClose: 100,
      complianceReady: true,
      supplierReady: true,
      commercialGate: "AMBER",
    });
    expect(p.priority).toBeGreaterThan(0);
  });

  it("does not invent supplier performance without history", () => {
    const score = calculateSupplierScore({
      relevance: 80,
      responseRate: null,
      responseSpeedScore: null,
      priceCompetitiveness: null,
      specMatchScore: null,
      deliveryReliability: null,
      quoteQuality: null,
      sampleSize: 0,
    });
    expect(score.total).toBeNull();
    expect(score.components.RESPONSE_RATE).toBe("INSUFFICIENT_HISTORY");
  });

  it("classifies formal quote replies", () => {
    const c = classifySupplierReply({
      subject: "Re: Quotation",
      body: "Please find attached our quotation #123",
    });
    expect(c.classification).toBe("FORMAL_QUOTE");
  });
});
