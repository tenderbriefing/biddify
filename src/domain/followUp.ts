export type FollowUpDecisionInput = {
  followUpCount: number;
  maxFollowUps: number;
  supplierResponded: boolean;
  hoursSinceLastContact: number;
  hoursToClose: number;
  quotesAlreadyObtained: number;
  sourcingStopped: boolean;
};

export type FollowUpDecision = {
  shouldFollowUp: boolean;
  reason: string;
};

export function decideFollowUp(input: FollowUpDecisionInput): FollowUpDecision {
  if (input.sourcingStopped) {
    return { shouldFollowUp: false, reason: "Sourcing stopped" };
  }
  if (input.supplierResponded) {
    return { shouldFollowUp: false, reason: "Supplier responded — cancel follow-ups" };
  }
  if (input.followUpCount >= input.maxFollowUps) {
    return { shouldFollowUp: false, reason: "Maximum follow-ups reached" };
  }
  if (input.quotesAlreadyObtained >= 2 && input.hoursToClose > 48) {
    return {
      shouldFollowUp: false,
      reason: "Sufficient quotes obtained — stop chasing",
    };
  }
  if (input.hoursToClose < 12) {
    return {
      shouldFollowUp: false,
      reason: "Deadline too close for further outreach",
    };
  }
  // First follow-up after ~48h; second only if still open and justified
  const minHours = input.followUpCount === 0 ? 48 : 72;
  if (input.hoursSinceLastContact < minHours) {
    return {
      shouldFollowUp: false,
      reason: `Wait until ${minHours}h since last contact`,
    };
  }
  return {
    shouldFollowUp: true,
    reason: `Follow-up ${input.followUpCount + 1} of ${input.maxFollowUps} justified`,
  };
}

export function shouldStopSourcing(input: {
  compliantQuoteCount: number;
  costConfidence: number;
  deliveryConfirmed: boolean;
  specConfidence: number;
  hoursToClose: number;
}): { stop: boolean; reason: string } {
  if (
    input.compliantQuoteCount >= 2 &&
    input.costConfidence >= 70 &&
    input.specConfidence >= 70 &&
    input.deliveryConfirmed
  ) {
    return {
      stop: true,
      reason: "Sufficient compliant quotes with delivery/spec confidence",
    };
  }
  if (input.hoursToClose < 24 && input.compliantQuoteCount >= 1) {
    return {
      stop: true,
      reason: "Deadline approaching — further outreach low value",
    };
  }
  return { stop: false, reason: "Continue sourcing" };
}
