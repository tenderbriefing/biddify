import { describe, expect, it } from "vitest";
import { selectBiddingCompany } from "./companySelection";
import { calculateCompanyReadiness } from "./companyReadiness";

describe("company selection / readiness", () => {
  it("never recommends DEMO companies", () => {
    const result = selectBiddingCompany({
      rfq: {
        isRealSource: true,
        isDemo: false,
        title: "Supply consumables dishwashing",
        province: "Gauteng",
      },
      companies: [
        {
          id: "demo",
          legalName: "DEMO Supply",
          isDemo: true,
          dataMode: "TEST",
          isActive: true,
          outboundSourcingEnabled: true,
          readinessOverall: "READY",
          readinessBlockers: [],
          hasMappedGmail: true,
          vatStatusKnown: true,
        },
        {
          id: "chem",
          legalName: "ORISON CHEMICALS",
          isDemo: false,
          dataMode: "OPERATIONAL",
          isActive: true,
          outboundSourcingEnabled: true,
          readinessOverall: "READY",
          readinessBlockers: [],
          province: "Gauteng",
          commodityCategories: "Chemicals, cleaning",
          hasMappedGmail: true,
          vatStatusKnown: true,
          relatedCompanyGroupId: "g1",
        },
      ],
    });
    expect(result.recommendedCompanyId).toBe("chem");
  });

  it("flags related-company competition risk", () => {
    const result = selectBiddingCompany({
      rfq: {
        isRealSource: true,
        isDemo: false,
        title: "Supply consumables",
      },
      companies: [
        {
          id: "a",
          legalName: "ORISON CHEMICALS",
          isDemo: false,
          dataMode: "OPERATIONAL",
          isActive: true,
          outboundSourcingEnabled: true,
          readinessOverall: "READY",
          readinessBlockers: [],
          commodityCategories: "Chemicals",
          hasMappedGmail: true,
          vatStatusKnown: true,
          relatedCompanyGroupId: "g1",
        },
        {
          id: "b",
          legalName: "ORISON SERVICES",
          isDemo: false,
          dataMode: "OPERATIONAL",
          isActive: true,
          outboundSourcingEnabled: true,
          readinessOverall: "READY",
          readinessBlockers: [],
          hasMappedGmail: false,
          vatStatusKnown: true,
          relatedCompanyGroupId: "g1",
        },
      ],
    });
    expect(result.relatedCompanyRisk).toBe(true);
  });

  it("surfaces exact readiness blockers", () => {
    const r = calculateCompanyReadiness({
      hasCipc: true,
      hasCsd: false,
      taxCompliant: "UNKNOWN",
      hasBee: false,
      hasBankConfirmation: true,
      vatStatusKnown: false,
    });
    expect(r.overall).toBe("ACTION_REQUIRED");
    expect(r.blockers.some((b) => /CSD/i.test(b))).toBe(true);
    expect(r.blockers.some((b) => /VAT/i.test(b))).toBe(true);
  });
});
