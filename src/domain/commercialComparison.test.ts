import { describe, expect, it } from "vitest";
import {
  buildBoqComparison,
  isQuoteExpired,
  recommendSourcingStrategy,
  summariseSupplierQuotes,
} from "./commercialComparison";
import { refreshPricingFromVerifiedQuotes } from "./pricingRefresh";
import { evaluateSubmissionReadiness } from "./submissionReadiness";
import { calculatePricing } from "./pricing";

const boq = [
  { id: "l1", description: "Dish liquid", quantity: 60, unit: "EA" },
  { id: "l2", description: "AAA Duracell", quantity: 150, unit: "EA" },
];

describe("manual quote commercial comparison", () => {
  it("flags incomplete, expired, unverified, and spec mismatch", () => {
    const rows = buildBoqComparison(boq, [
      {
        rfqLineItemId: "l1",
        quoteId: "q1",
        quoteLineId: "ql1",
        supplierId: "s1",
        supplierName: "A",
        unitCost: 10,
        lineTotal: 600,
        matchState: "EXACT_MATCH",
        evidenceType: "SUPPLIER_QUOTE",
        verificationState: "UNVERIFIED",
      },
      {
        rfqLineItemId: "l2",
        quoteId: "q1",
        quoteLineId: "ql2",
        supplierId: "s1",
        supplierName: "A",
        unitCost: 5,
        lineTotal: 750,
        matchState: "NON_COMPLIANT",
        evidenceType: "SUPPLIER_QUOTE",
        verificationState: "VERIFIED",
      },
    ]);
    expect(rows[0]!.flags).toContain("UNVERIFIED_EVIDENCE");
    expect(rows[1]!.flags).toContain("SPEC_MISMATCH");
  });

  it("does not crown cheapest incomplete quote as CHEAPEST_COMPLETE_QUOTE", () => {
    const summaries = summariseSupplierQuotes({
      boqLineIds: ["l1", "l2"],
      quotes: [
        {
          quoteId: "cheap",
          supplierId: "s1",
          supplierName: "Cheap Incomplete",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          subtotal: 100,
          vatAmount: 0,
          deliveryCost: 10,
          deliveryKnown: true,
          validUntil: null,
          leadTimeDays: 2,
          coveredLineIds: ["l1"],
          isCompleteClaim: false,
        },
        {
          quoteId: "full",
          supplierId: "s2",
          supplierName: "Full",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          subtotal: 500,
          vatAmount: 0,
          deliveryCost: 50,
          deliveryKnown: true,
          validUntil: null,
          leadTimeDays: 3,
          coveredLineIds: ["l1", "l2"],
          isCompleteClaim: true,
        },
      ],
    });
    const crowned = summaries.find((s) =>
      s.flags.includes("CHEAPEST_COMPLETE_QUOTE"),
    );
    expect(crowned?.quoteId).toBe("full");
    expect(
      summaries.find((s) => s.quoteId === "cheap")?.flags,
    ).toContain("INCOMPLETE_QUOTE");
  });

  it("detects expired quotes", () => {
    expect(isQuoteExpired(new Date("2020-01-01"), new Date("2026-10-12"))).toBe(
      true,
    );
    expect(isQuoteExpired(null)).toBe(false);
  });

  it("recommends split award when no complete single supplier exists", () => {
    const rec = recommendSourcingStrategy({
      boq: [
        { id: "l1", quantity: 10 },
        { id: "l2", quantity: 5 },
      ],
      offers: [
        {
          rfqLineItemId: "l1",
          quoteId: "q1",
          quoteLineId: "a",
          supplierId: "s1",
          supplierName: "S1",
          unitCost: 10,
          lineTotal: 100,
          matchState: "EXACT_MATCH",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          deliveryCost: 20,
          deliveryKnown: true,
          quoteExpired: false,
        },
        {
          rfqLineItemId: "l2",
          quoteId: "q2",
          quoteLineId: "b",
          supplierId: "s2",
          supplierName: "S2",
          unitCost: 40,
          lineTotal: 200,
          matchState: "COMPLIANT_EQUIVALENT",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          deliveryCost: 30,
          deliveryKnown: true,
          quoteExpired: false,
        },
      ],
    });
    expect(rec.label).toBe("SYSTEM_RECOMMENDATION");
    expect(rec.strategyType).toBe("SPLIT_AWARD");
    expect(rec.goodsCost).toBe(300);
    expect(rec.deliveryKnown).toBe(true);
    expect(rec.totalLandedEstimate).toBe(350);
  });

  it("excludes unverified evidence from recommendations", () => {
    const rec = recommendSourcingStrategy({
      boq: [{ id: "l1", quantity: 1 }],
      offers: [
        {
          rfqLineItemId: "l1",
          quoteId: "q1",
          quoteLineId: "a",
          supplierId: "s1",
          supplierName: "Cheap unverified",
          unitCost: 1,
          lineTotal: 1,
          matchState: "EXACT_MATCH",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "UNVERIFIED",
          deliveryCost: 0,
          deliveryKnown: true,
          quoteExpired: false,
        },
      ],
    });
    expect(rec.lines).toHaveLength(0);
    expect(rec.blockers.length).toBeGreaterThan(0);
  });

  it("prefers complete single supplier when available", () => {
    const rec = recommendSourcingStrategy({
      boq: [
        { id: "l1", quantity: 2 },
        { id: "l2", quantity: 3 },
      ],
      offers: [
        {
          rfqLineItemId: "l1",
          quoteId: "q1",
          quoteLineId: "a",
          supplierId: "s1",
          supplierName: "One",
          unitCost: 10,
          lineTotal: 20,
          matchState: "EXACT_MATCH",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          deliveryCost: 15,
          deliveryKnown: true,
          quoteExpired: false,
        },
        {
          rfqLineItemId: "l2",
          quoteId: "q1",
          quoteLineId: "b",
          supplierId: "s1",
          supplierName: "One",
          unitCost: 20,
          lineTotal: 60,
          matchState: "EXACT_MATCH",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          deliveryCost: 15,
          deliveryKnown: true,
          quoteExpired: false,
        },
      ],
    });
    expect(rec.strategyType).toBe("SINGLE_SUPPLIER");
    expect(rec.goodsCost).toBe(80);
    expect(rec.totalLandedEstimate).toBe(95);
  });
});

describe("pricing refresh + markup vs margin", () => {
  it("refreshes from verified recommendation and keeps markup≠margin", () => {
    const rec = recommendSourcingStrategy({
      boq: [{ id: "l1", quantity: 10 }],
      offers: [
        {
          rfqLineItemId: "l1",
          quoteId: "q1",
          quoteLineId: "a",
          supplierId: "s1",
          supplierName: "S",
          unitCost: 10,
          lineTotal: 100,
          matchState: "EXACT_MATCH",
          evidenceType: "SUPPLIER_QUOTE",
          verificationState: "VERIFIED",
          deliveryCost: 20,
          deliveryKnown: true,
          quoteExpired: false,
        },
      ],
    });
    const refreshed = refreshPricingFromVerifiedQuotes({
      recommendation: rec,
      markupPercent: 20,
      companyVatRegistered: false,
    });
    expect(refreshed.ok).toBe(true);
    expect(refreshed.landedCost).toBe(120);
    expect(refreshed.sellingPriceExVat).toBe(144);
    expect(refreshed.markupAmount).toBe(24);
    expect(refreshed.grossMarginPercent).toBe(16.67);
    expect(refreshed.vatAmount).toBe(0);
  });

  it("applies company VAT only when company is VAT registered", () => {
    const priced = calculatePricing({
      supplierCost: 100,
      delivery: 0,
      markupPercent: 20,
      vatRegistered: true,
      vatRatePercent: 15,
    });
    expect(priced.sellingPriceExVat).toBe(120);
    expect(priced.vatAmount).toBe(18);
    expect(priced.totalQuotation).toBe(138);
  });
});

describe("READY_TO_SUBMIT gate", () => {
  it("blocks until all mandatory commercial/compliance gates pass", () => {
    const blocked = evaluateSubmissionReadiness({
      companySelected: true,
      eligibilityPassed: false,
      eligibilityWarningAccepted: false,
      eligibilityVerdict: "ELIGIBLE_WITH_WARNING",
      boqComplete: true,
      verifiedSupplierPricing: false,
      sourcingStrategyConfirmed: false,
      commercialsFounderApproved: false,
      mandatoryComplianceComplete: false,
      signaturesComplete: false,
      unresolvedBlockingWarnings: [],
    });
    expect(blocked.readyToSubmit).toBe(false);
    expect(blocked.blockers.some((b) => /eligibility warning/i.test(b))).toBe(
      true,
    );
    expect(blocked.blockers.some((b) => /SUPPLIER_QUOTE/i.test(b))).toBe(true);
  });

  it("passes only when every gate is true", () => {
    const ok = evaluateSubmissionReadiness({
      companySelected: true,
      eligibilityPassed: true,
      eligibilityWarningAccepted: true,
      eligibilityVerdict: "ELIGIBLE",
      boqComplete: true,
      verifiedSupplierPricing: true,
      sourcingStrategyConfirmed: true,
      commercialsFounderApproved: true,
      mandatoryComplianceComplete: true,
      signaturesComplete: true,
      unresolvedBlockingWarnings: [],
    });
    expect(ok.readyToSubmit).toBe(true);
  });
});
