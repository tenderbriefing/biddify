export const PIPELINE_STATUSES = [
  "NEW",
  "REVIEW",
  "QUALIFIED",
  "SOURCING",
  "AWAITING_SUPPLIERS",
  "PRICING",
  "COMPLIANCE",
  "FOUNDER_REVIEW",
  "APPROVED",
  "SUBMISSION_AUTHORISED",
  "SUBMITTED",
  "AWARDED",
  "LOST",
  "NO_BID",
  "CANCELLED",
  "FULFILMENT",
  "PAID",
] as const;

export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

/** Allowed forward transitions. Invalid transitions are rejected. */
const ALLOWED: Record<PipelineStatus, PipelineStatus[]> = {
  NEW: ["REVIEW", "NO_BID", "CANCELLED"],
  REVIEW: ["QUALIFIED", "NO_BID", "CANCELLED", "NEW"],
  QUALIFIED: ["SOURCING", "NO_BID", "CANCELLED"],
  SOURCING: ["AWAITING_SUPPLIERS", "PRICING", "NO_BID", "CANCELLED"],
  AWAITING_SUPPLIERS: ["PRICING", "SOURCING", "NO_BID", "CANCELLED"],
  PRICING: ["COMPLIANCE", "SOURCING", "NO_BID", "CANCELLED"],
  COMPLIANCE: ["FOUNDER_REVIEW", "PRICING", "NO_BID", "CANCELLED"],
  FOUNDER_REVIEW: ["APPROVED", "COMPLIANCE", "NO_BID", "CANCELLED"],
  APPROVED: ["SUBMISSION_AUTHORISED", "FOUNDER_REVIEW", "CANCELLED"],
  SUBMISSION_AUTHORISED: ["SUBMITTED", "APPROVED", "CANCELLED"],
  SUBMITTED: ["AWARDED", "LOST", "CANCELLED"],
  AWARDED: ["FULFILMENT", "CANCELLED"],
  LOST: [],
  NO_BID: [],
  CANCELLED: [],
  FULFILMENT: ["PAID", "CANCELLED"],
  PAID: [],
};

export type TransitionContext = {
  /** Founder approval record must exist and be valid before submission authorisation. */
  hasValidFounderApproval?: boolean;
  /** Material commercial change after approval invalidates and blocks submit path. */
  approvalInvalidated?: boolean;
};

export type TransitionResult =
  | { ok: true; from: PipelineStatus; to: PipelineStatus }
  | { ok: false; from: PipelineStatus; to: PipelineStatus; reason: string };

export function canTransition(
  from: PipelineStatus,
  to: PipelineStatus,
  ctx: TransitionContext = {},
): TransitionResult {
  if (from === to) {
    return { ok: false, from, to, reason: "Status unchanged" };
  }

  const allowed = ALLOWED[from] ?? [];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      from,
      to,
      reason: `Invalid transition ${from} → ${to}`,
    };
  }

  if (to === "SUBMISSION_AUTHORISED") {
    if (!ctx.hasValidFounderApproval) {
      return {
        ok: false,
        from,
        to,
        reason: "Founder approval required before SUBMISSION_AUTHORISED",
      };
    }
    if (ctx.approvalInvalidated) {
      return {
        ok: false,
        from,
        to,
        reason: "Approval invalidated by material change — re-approval required",
      };
    }
  }

  if (to === "SUBMITTED") {
    if (from !== "SUBMISSION_AUTHORISED") {
      return {
        ok: false,
        from,
        to,
        reason: "Bid must be SUBMISSION_AUTHORISED before SUBMITTED",
      };
    }
    if (!ctx.hasValidFounderApproval || ctx.approvalInvalidated) {
      return {
        ok: false,
        from,
        to,
        reason: "Valid Founder approval required to submit",
      };
    }
  }

  return { ok: true, from, to };
}

export function assertTransition(
  from: PipelineStatus,
  to: PipelineStatus,
  ctx: TransitionContext = {},
): void {
  const result = canTransition(from, to, ctx);
  if (!result.ok) {
    throw new Error(result.reason);
  }
}
