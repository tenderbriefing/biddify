import { describe, expect, it } from "vitest";
import { determineNextAction } from "./nextAction";

const closing = new Date(Date.now() + 7 * 86400000);

describe("Phase 3 next-action engine", () => {
  it("asks to download documents when none exist", () => {
    const result = determineNextAction({
      status: "NEW",
      qualificationGate: "AMBER",
      hardNoBid: false,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      documentCount: 0,
      closingAt: closing,
    });
    expect(result.action).toBe("DOWNLOAD_DOCUMENTS");
  });

  it("asks to verify extraction before sourcing", () => {
    const result = determineNextAction({
      status: "QUALIFIED",
      qualificationGate: "AMBER",
      hardNoBid: false,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      documentCount: 1,
      documentsDownloaded: true,
      extractionDone: true,
      extractionVerified: false,
      lineItemCount: 5,
      closingAt: closing,
    });
    expect(result.action).toBe("VERIFY_EXTRACTION");
  });

  it("routes OEM to VERIFY_OEM_AUTHORIZATION not automatic NO_BID", () => {
    const result = determineNextAction({
      status: "QUALIFIED",
      qualificationGate: "AMBER",
      hardNoBid: false,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      documentCount: 1,
      documentsDownloaded: true,
      extractionDone: true,
      extractionVerified: true,
      lineItemCount: 3,
      selectedCompanyId: "co1",
      hasOemRequirement: true,
      oemVerified: false,
      closingAt: closing,
    });
    expect(result.action).toBe("VERIFY_OEM_AUTHORIZATION");
  });

  it("requests quote drafts after suppliers identified", () => {
    const result = determineNextAction({
      status: "SOURCING",
      qualificationGate: "AMBER",
      hardNoBid: false,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      documentCount: 1,
      documentsDownloaded: true,
      extractionDone: true,
      extractionVerified: true,
      lineItemCount: 5,
      selectedCompanyId: "co1",
      supplierCount: 2,
      enquiryDraftCount: 0,
      closingAt: closing,
    });
    expect(result.action).toBe("REQUEST_QUOTES");
  });

  it("moves to working-capital review when commercial gate is AMBER", () => {
    const result = determineNextAction({
      status: "PRICING",
      qualificationGate: "AMBER",
      commercialGate: "AMBER",
      hardNoBid: false,
      classification: "SUPPLY_AND_DELIVER",
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
      documentCount: 1,
      documentsDownloaded: true,
      extractionDone: true,
      extractionVerified: true,
      lineItemCount: 5,
      selectedCompanyId: "co1",
      supplierCount: 2,
      enquiryDraftCount: 2,
      quoteCount: 2,
      pricingComplete: true,
      productMatchVerified: true,
      logisticsCalculated: true,
      closingAt: closing,
    });
    expect(result.action).toBe("VERIFY_WORKING_CAPITAL");
  });
});
