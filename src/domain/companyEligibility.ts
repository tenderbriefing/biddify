export type EligibilityVerdict = "ELIGIBLE" | "ELIGIBLE_WITH_WARNING" | "NOT_ELIGIBLE";

export type EligibilityEvidence = {
  source: string;
  finding: string;
};

export type CompanyEligibilityResult = {
  verdict: EligibilityVerdict;
  companyLegalName: string;
  rfqInternalId: string;
  evidence: EligibilityEvidence[];
  warnings: string[];
  blockers: string[];
};

/**
 * Compare RFQ mandatory conditions to company evidence.
 * Never infer eligibility from company name alone.
 */
export function evaluateCompanyEligibility(input: {
  rfqInternalId: string;
  companyLegalName: string;
  rfqRequiresCsd: boolean;
  companyHasActiveCsd: boolean;
  rfqRequiresCompulsoryBriefing: boolean;
  briefingAttendedOrNotApplicable: boolean;
  rfqStatesCommodityRestriction: boolean;
  companyCsdCommodityMatchesRfq: boolean | "UNKNOWN";
  rfqRequiresSpecialLicence: boolean;
  companyHasRequiredLicence: boolean | "NOT_APPLICABLE";
  companyRestrictedOnCsd: boolean;
  companyTaxCompliant: boolean | "UNKNOWN";
}): CompanyEligibilityResult {
  const evidence: EligibilityEvidence[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];

  if (input.rfqRequiresCsd) {
    evidence.push({
      source: "RFQ",
      finding: "CSD registration required for all quotation respondents",
    });
    if (!input.companyHasActiveCsd) {
      blockers.push("Company has no active CSD evidence");
    } else {
      evidence.push({
        source: "Company CSD",
        finding: "Active CSD registration evidence on file",
      });
    }
  }

  if (input.rfqRequiresCompulsoryBriefing && !input.briefingAttendedOrNotApplicable) {
    blockers.push("Compulsory briefing not satisfied");
  }

  if (input.companyRestrictedOnCsd) {
    blockers.push("Company or director restricted on CSD");
  }

  if (input.rfqRequiresSpecialLicence) {
    if (input.companyHasRequiredLicence === false) {
      blockers.push("Required licence missing");
    }
  }

  if (input.rfqStatesCommodityRestriction) {
    if (input.companyCsdCommodityMatchesRfq === false) {
      blockers.push("CSD commodity/category does not satisfy mandatory RFQ commodity restriction");
    } else if (input.companyCsdCommodityMatchesRfq === "UNKNOWN") {
      warnings.push("RFQ commodity restriction present but company match UNKNOWN");
    }
  } else {
    evidence.push({
      source: "RFQ",
      finding:
        "No mandatory commodity/UNSPSC/CIDB/licence category restriction stated for this consumables RFQ",
    });
    if (input.companyCsdCommodityMatchesRfq === false) {
      warnings.push(
        "Company CSD industry classification does not describe these consumables — not a hard RFQ disqualifier, but Founder should confirm commercial/category fit and update CSD commodities if bidding",
      );
    }
  }

  if (input.companyTaxCompliant === false) {
    blockers.push("Tax compliance not ready");
  } else if (input.companyTaxCompliant === "UNKNOWN") {
    warnings.push("Tax compliance UNKNOWN");
  }

  let verdict: EligibilityVerdict = "ELIGIBLE";
  if (blockers.length > 0) verdict = "NOT_ELIGIBLE";
  else if (warnings.length > 0) verdict = "ELIGIBLE_WITH_WARNING";

  return {
    verdict,
    companyLegalName: input.companyLegalName,
    rfqInternalId: input.rfqInternalId,
    evidence,
    warnings,
    blockers,
  };
}
