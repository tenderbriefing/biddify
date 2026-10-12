/**
 * BID PRIORITY — not win probability.
 * Transparent ranking for Founder Bid Queue.
 */

export type BidPriorityInput = {
  expectedGrossProfit: number;
  grossMarginPercent: number;
  workingCapitalRequired: number;
  costConfidence: number;
  specConfidence: number;
  hoursToClose: number;
  complianceReady: boolean;
  supplierReady: boolean;
  commercialGate: "GREEN" | "AMBER" | "RED" | "UNREVIEWED";
};

export type BidPriorityResult = {
  priority: number;
  capitalEfficiency: number | null;
  reasons: string[];
};

export function calculateCapitalEfficiency(
  expectedGrossProfit: number,
  workingCapitalRequired: number,
): number | null {
  if (workingCapitalRequired <= 0) return null;
  return Math.round((expectedGrossProfit / workingCapitalRequired) * 1000) / 1000;
}

export function calculateBidPriority(input: BidPriorityInput): BidPriorityResult {
  const reasons: string[] = [];
  let priority = 0;

  const efficiency = calculateCapitalEfficiency(
    input.expectedGrossProfit,
    input.workingCapitalRequired,
  );
  if (efficiency != null) {
    const effScore = Math.min(25, Math.round(efficiency * 100));
    priority += effScore;
    reasons.push(`Capital efficiency GP/WC=${efficiency} (+${effScore})`);
  }

  const marginScore = Math.min(20, Math.max(0, Math.round(input.grossMarginPercent)));
  priority += marginScore;
  reasons.push(`Margin contribution (+${marginScore})`);

  const conf = Math.round((input.costConfidence + input.specConfidence) / 10);
  priority += Math.min(20, conf);
  reasons.push(`Confidence contribution (+${Math.min(20, conf)})`);

  if (input.hoursToClose <= 48) {
    priority += 15;
    reasons.push("Closes ≤48h (+15)");
  } else if (input.hoursToClose <= 168) {
    priority += 8;
    reasons.push("Closes ≤7d (+8)");
  }

  if (input.complianceReady) {
    priority += 8;
    reasons.push("Compliance ready (+8)");
  }
  if (input.supplierReady) {
    priority += 7;
    reasons.push("Supplier ready (+7)");
  }

  if (input.commercialGate === "GREEN") {
    priority += 15;
    reasons.push("Commercial GREEN (+15)");
  } else if (input.commercialGate === "RED") {
    priority -= 30;
    reasons.push("Commercial RED (−30)");
  } else if (input.commercialGate === "AMBER") {
    priority += 2;
    reasons.push("Commercial AMBER (+2)");
  }

  return {
    priority: Math.max(0, priority),
    capitalEfficiency: efficiency,
    reasons,
  };
}
