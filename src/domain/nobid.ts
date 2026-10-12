import type { PipelineStatus } from "./status";
import { canTransition } from "./status";

export const NO_BID_CATEGORIES = [
  "DEADLINE",
  "BRIEFING_MISSED",
  "COMPLIANCE",
  "LICENCE",
  "GRADING",
  "SUPPLIER_UNAVAILABLE",
  "DELIVERY",
  "CAPITAL",
  "MARGIN",
  "SPECIFICATION",
  "COMPANY_NOT_ELIGIBLE",
  "FOUNDER_REJECTED",
  "OTHER",
] as const;

export type NoBidCategory = (typeof NO_BID_CATEGORIES)[number];

export type NoBidDecisionInput = {
  currentStatus: PipelineStatus;
  category: NoBidCategory;
  notes?: string;
  /** System recommendation vs explicit human decision */
  decidedBy: "SYSTEM_RECOMMENDATION" | "OPERATOR" | "FOUNDER";
};

export type NoBidDecision = {
  ok: boolean;
  status: PipelineStatus;
  category: NoBidCategory;
  reason: string;
  notes: string;
  error?: string;
};

export function buildNoBidReason(
  category: NoBidCategory,
  notes?: string,
): string {
  const base = `NO BID · ${category.replaceAll("_", " ")}`;
  const trimmed = notes?.trim();
  return trimmed ? `${base}: ${trimmed}` : base;
}

/**
 * Record a NO BID decision. Transition must be valid from current status.
 * Recommendation-only callers should not invoke this until an operator confirms,
 * unless applying an explicit hard rule with audit.
 */
export function createNoBidDecision(input: NoBidDecisionInput): NoBidDecision {
  const transition = canTransition(input.currentStatus, "NO_BID");
  if (!transition.ok) {
    return {
      ok: false,
      status: input.currentStatus,
      category: input.category,
      reason: buildNoBidReason(input.category, input.notes),
      notes: input.notes?.trim() ?? "",
      error: transition.reason,
    };
  }

  if (
    (input.category === "OTHER" || input.category === "SPECIFICATION") &&
    !input.notes?.trim()
  ) {
    return {
      ok: false,
      status: input.currentStatus,
      category: input.category,
      reason: "",
      notes: "",
      error: `Explanatory notes required for category ${input.category}`,
    };
  }

  return {
    ok: true,
    status: "NO_BID",
    category: input.category,
    reason: buildNoBidReason(input.category, input.notes),
    notes: input.notes?.trim() ?? "",
  };
}
