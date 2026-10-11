import type { PricingResult } from "./pricing";

export type ProfitabilityGate = "GREEN" | "AMBER" | "RED" | "UNREVIEWED";

export type ProfitabilityFactors = {
  pricing: PricingResult;
  /** Days until customer payment after delivery (estimate). */
  customerPaymentDays?: number;
  /** True if mandatory compliance items are missing. */
  complianceBlocked?: boolean;
  /** True if no viable supplier quote. */
  noSupplier?: boolean;
  /** Hours remaining until closing. */
  hoursToDeadline?: number;
  /** Delivery assessed as operationally impossible. */
  deliveryImpossible?: boolean;
};

export type ProfitabilityRecommendation = {
  gate: ProfitabilityGate;
  reasons: string[];
};

/**
 * Transparent commercial recommendation. AI may assist later; this is deterministic.
 * Founder retains final approval authority.
 */
export function recommendProfitability(
  factors: ProfitabilityFactors,
): ProfitabilityRecommendation {
  const reasons: string[] = [];
  let gate: ProfitabilityGate = "GREEN";

  const { pricing } = factors;
  const margin = pricing.grossMarginPercent;
  const gp = pricing.grossProfit;
  const wc = pricing.workingCapitalRequired;

  if (factors.complianceBlocked) {
    reasons.push("Mandatory compliance items missing — submission blocked");
    gate = "RED";
  }
  if (factors.noSupplier) {
    reasons.push("No viable supplier quote available");
    gate = "RED";
  }
  if (factors.deliveryImpossible) {
    reasons.push("Delivery requirements assessed as impractical");
    gate = "RED";
  }
  if (factors.hoursToDeadline !== undefined && factors.hoursToDeadline < 0) {
    reasons.push("Deadline has passed");
    gate = "RED";
  }
  if (gp <= 0) {
    reasons.push("Gross profit is zero or negative");
    gate = "RED";
  } else if (margin < 10) {
    reasons.push(`Gross margin ${margin}% is below 10% threshold`);
    gate = worsen(gate, "RED");
  } else if (margin < 14) {
    reasons.push(`Gross margin ${margin}% is thin — Founder review advised`);
    gate = worsen(gate, "AMBER");
  } else {
    reasons.push(`Gross margin ${margin}% meets initial attractiveness band`);
  }

  if (wc > 0 && gp > 0 && wc > gp * 8) {
    reasons.push(
      `Working capital R${wc.toLocaleString("en-ZA")} is high relative to GP`,
    );
    gate = worsen(gate, "AMBER");
  }

  if (
    factors.customerPaymentDays !== undefined &&
    factors.customerPaymentDays > 45
  ) {
    reasons.push(
      `Customer payment terms ~${factors.customerPaymentDays} days elevate cash risk`,
    );
    gate = worsen(gate, "AMBER");
  }

  if (
    factors.hoursToDeadline !== undefined &&
    factors.hoursToDeadline >= 0 &&
    factors.hoursToDeadline < 48
  ) {
    reasons.push("Less than 48 hours to closing");
    gate = worsen(gate, "AMBER");
  }

  if (reasons.length === 0) {
    reasons.push("No adverse commercial factors flagged");
  }

  return { gate, reasons };
}

function worsen(
  current: ProfitabilityGate,
  next: ProfitabilityGate,
): ProfitabilityGate {
  const rank: Record<ProfitabilityGate, number> = {
    GREEN: 0,
    UNREVIEWED: 1,
    AMBER: 2,
    RED: 3,
  };
  return rank[next] > rank[current] ? next : current;
}
