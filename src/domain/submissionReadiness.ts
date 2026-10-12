/**
 * READY_TO_SUBMIT gate — Gmail/email transport is intentionally excluded.
 */

export type SubmissionReadinessInput = {
  companySelected: boolean;
  eligibilityPassed: boolean;
  /** ELIGIBLE_WITH_WARNING requires explicit Founder acceptance */
  eligibilityWarningAccepted: boolean;
  eligibilityVerdict?: string | null;
  boqComplete: boolean;
  verifiedSupplierPricing: boolean;
  sourcingStrategyConfirmed: boolean;
  commercialsFounderApproved: boolean;
  mandatoryComplianceComplete: boolean;
  signaturesComplete: boolean;
  unresolvedBlockingWarnings: string[];
};

export type SubmissionReadinessResult = {
  readyToSubmit: boolean;
  blockers: string[];
};

export function evaluateSubmissionReadiness(
  input: SubmissionReadinessInput,
): SubmissionReadinessResult {
  const blockers: string[] = [];

  if (!input.companySelected) blockers.push("Bidding company not selected");
  if (!input.eligibilityPassed) {
    if (input.eligibilityVerdict === "ELIGIBLE_WITH_WARNING") {
      if (!input.eligibilityWarningAccepted) {
        blockers.push("Eligibility warning not accepted by Founder");
      }
    } else if (input.eligibilityVerdict === "NOT_ELIGIBLE") {
      blockers.push("Company not eligible");
    } else {
      blockers.push("Eligibility not passed");
    }
  }
  if (!input.boqComplete) blockers.push("BOQ incomplete");
  if (!input.verifiedSupplierPricing) {
    blockers.push("Verified SUPPLIER_QUOTE pricing not available");
  }
  if (!input.sourcingStrategyConfirmed) {
    blockers.push("Sourcing strategy not Founder-confirmed");
  }
  if (!input.commercialsFounderApproved) {
    blockers.push("Commercials not Founder-approved");
  }
  if (!input.mandatoryComplianceComplete) {
    blockers.push("Mandatory compliance requirements incomplete");
  }
  if (!input.signaturesComplete) {
    blockers.push("Required signatures/forms incomplete");
  }
  blockers.push(...input.unresolvedBlockingWarnings);

  return {
    readyToSubmit: blockers.length === 0,
    blockers,
  };
}
