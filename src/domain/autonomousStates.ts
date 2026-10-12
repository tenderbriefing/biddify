/**
 * Autonomous RFQ Engine V1 processing lifecycle.
 * Terminal outcomes never block the queue — worker always continues.
 */

export const AUTONOMOUS_PROCESSING_STATES = [
  "DISCOVERED",
  "CLASSIFYING",
  "NOT_SUPPLY_AND_DELIVER",
  "INGESTING_DOCUMENTS",
  "ANALYSING_REQUIREMENTS",
  "ELIGIBILITY_CHECK",
  "BOQ_EXTRACTION",
  "PRODUCT_RESEARCH",
  "PRODUCT_MATCHING",
  "PRICING",
  "QUOTATION_GENERATION",
  "COMPLIANCE_CHECK",
  "AUTO_QUOTED",
  "REVIEW_REQUIRED",
  "UNPRICEABLE",
  "INELIGIBLE",
  "FAILED",
  "COMPLETED",
] as const;

export type AutonomousProcessingState =
  (typeof AUTONOMOUS_PROCESSING_STATES)[number];

export const AUTONOMOUS_OUTCOMES = [
  "AUTO_QUOTED",
  "REVIEW_REQUIRED",
  "UNPRICEABLE",
  "INELIGIBLE",
  "FAILED",
  "SKIPPED_NOT_SUPPLY",
] as const;

export type AutonomousOutcome = (typeof AUTONOMOUS_OUTCOMES)[number];

export const TERMINAL_AUTONOMOUS_STATES: ReadonlySet<AutonomousProcessingState> =
  new Set([
    "NOT_SUPPLY_AND_DELIVER",
    "AUTO_QUOTED",
    "REVIEW_REQUIRED",
    "UNPRICEABLE",
    "INELIGIBLE",
    "FAILED",
    "COMPLETED",
  ]);

export const WORKER_VERSION = "autonomous-rfq-engine-v1";

/** Transient failures may retry; structural outcomes must not. */
export const MAX_TRANSIENT_RETRIES = 2;

export const CLAIM_TTL_MS = 15 * 60 * 1000;

export function isTerminalState(
  state: AutonomousProcessingState | null | undefined,
): boolean {
  if (!state) return false;
  return TERMINAL_AUTONOMOUS_STATES.has(state);
}

export function outcomeFromState(
  state: AutonomousProcessingState,
): AutonomousOutcome | null {
  switch (state) {
    case "AUTO_QUOTED":
      return "AUTO_QUOTED";
    case "REVIEW_REQUIRED":
      return "REVIEW_REQUIRED";
    case "UNPRICEABLE":
      return "UNPRICEABLE";
    case "INELIGIBLE":
      return "INELIGIBLE";
    case "FAILED":
      return "FAILED";
    case "NOT_SUPPLY_AND_DELIVER":
      return "SKIPPED_NOT_SUPPLY";
    default:
      return null;
  }
}

export function isRetryableFailure(reason: string): boolean {
  const r = reason.toLowerCase();
  return (
    r.includes("timeout") ||
    r.includes("temporary") ||
    r.includes("transient") ||
    r.includes("lock") ||
    r.includes("busy") ||
    r.includes("network")
  );
}
