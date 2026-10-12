import { roundMoney, toNumber } from "./money";

export type CapitalControlsInput = {
  totalLimit: number | null;
  companyLimit: number | null;
  capitalCommitted: number;
  capitalPotentialApproved: number;
  capitalRequested: number;
};

export type CapitalControlsResult = {
  remainingTotal: number | null;
  remainingCompany: number | null;
  fundingRequired: boolean;
  reasons: string[];
};

/**
 * Flag FUNDING REQUIRED — do not auto-reject attractive RFQs.
 */
export function evaluateCapitalControls(
  input: CapitalControlsInput,
): CapitalControlsResult {
  const reasons: string[] = [];
  const committed = roundMoney(toNumber(input.capitalCommitted));
  const potential = roundMoney(toNumber(input.capitalPotentialApproved));
  const requested = roundMoney(toNumber(input.capitalRequested));

  let remainingTotal: number | null = null;
  let remainingCompany: number | null = null;
  let fundingRequired = false;

  if (input.totalLimit != null) {
    remainingTotal = roundMoney(
      toNumber(input.totalLimit) - committed - potential,
    );
    if (requested > remainingTotal) {
      fundingRequired = true;
      reasons.push(
        `Total capital shortfall: need ${requested}, remaining ${remainingTotal}`,
      );
    }
  } else {
    reasons.push("Total procurement capital limit UNKNOWN");
  }

  if (input.companyLimit != null) {
    remainingCompany = roundMoney(toNumber(input.companyLimit) - committed);
    if (requested > remainingCompany) {
      fundingRequired = true;
      reasons.push(
        `Company capital shortfall: need ${requested}, remaining ${remainingCompany}`,
      );
    }
  }

  if (fundingRequired) {
    reasons.push("FUNDING REQUIRED — do not auto-reject; flag for financing/Founder");
  }

  return { remainingTotal, remainingCompany, fundingRequired, reasons };
}
