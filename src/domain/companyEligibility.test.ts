import { describe, expect, it } from "vitest";
import { evaluateCompanyEligibility } from "./companyEligibility";

describe("company eligibility vs RFQ", () => {
  it("returns ELIGIBLE_WITH_WARNING when CSD industry mismatches but RFQ has no commodity restriction", () => {
    const result = evaluateCompanyEligibility({
      rfqInternalId: "BID-000011",
      companyLegalName: "ORISON CHEMICALS",
      rfqRequiresCsd: true,
      companyHasActiveCsd: true,
      rfqRequiresCompulsoryBriefing: false,
      briefingAttendedOrNotApplicable: true,
      rfqStatesCommodityRestriction: false,
      companyCsdCommodityMatchesRfq: false,
      rfqRequiresSpecialLicence: false,
      companyHasRequiredLicence: "NOT_APPLICABLE",
      companyRestrictedOnCsd: false,
      companyTaxCompliant: true,
    });
    expect(result.verdict).toBe("ELIGIBLE_WITH_WARNING");
    expect(result.blockers).toHaveLength(0);
  });

  it("returns NOT_ELIGIBLE when mandatory commodity restriction fails", () => {
    const result = evaluateCompanyEligibility({
      rfqInternalId: "BID-000011",
      companyLegalName: "ORISON CHEMICALS",
      rfqRequiresCsd: true,
      companyHasActiveCsd: true,
      rfqRequiresCompulsoryBriefing: false,
      briefingAttendedOrNotApplicable: true,
      rfqStatesCommodityRestriction: true,
      companyCsdCommodityMatchesRfq: false,
      rfqRequiresSpecialLicence: false,
      companyHasRequiredLicence: "NOT_APPLICABLE",
      companyRestrictedOnCsd: false,
      companyTaxCompliant: true,
    });
    expect(result.verdict).toBe("NOT_ELIGIBLE");
  });

  it("does not infer eligibility from company name alone", () => {
    const result = evaluateCompanyEligibility({
      rfqInternalId: "X",
      companyLegalName: "CHEMICALS ANYTHING",
      rfqRequiresCsd: true,
      companyHasActiveCsd: false,
      rfqRequiresCompulsoryBriefing: false,
      briefingAttendedOrNotApplicable: true,
      rfqStatesCommodityRestriction: false,
      companyCsdCommodityMatchesRfq: "UNKNOWN",
      rfqRequiresSpecialLicence: false,
      companyHasRequiredLicence: "NOT_APPLICABLE",
      companyRestrictedOnCsd: false,
      companyTaxCompliant: "UNKNOWN",
    });
    expect(result.verdict).toBe("NOT_ELIGIBLE");
  });
});
