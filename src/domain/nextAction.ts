import type { OpportunityClass } from "./classification";
import type { PipelineStatus } from "./status";
import { evaluateDeadline } from "./deadlines";

export const NEXT_ACTIONS = [
  "REVIEW_DOCUMENTS",
  "VERIFY_COMPULSORY_BRIEFING",
  "SELECT_BIDDING_COMPANY",
  "SOURCE_SUPPLIERS",
  "VERIFY_LICENCE",
  "CONFIRM_DELIVERY",
  "NO_BID",
  "READY_FOR_SOURCING",
  "COMPLETE_COMPLIANCE",
  "FOUNDERS_REVIEW",
  "AWAIT_DEADLINE",
  "MANUAL_REVIEW",
] as const;

export type NextAction = (typeof NEXT_ACTIONS)[number];

export type NextActionInput = {
  status: PipelineStatus;
  qualificationGate: "GREEN" | "AMBER" | "RED" | "UNREVIEWED";
  hardNoBid: boolean;
  classification?: OpportunityClass | null;
  selectedCompanyId?: string | null;
  briefingCompulsory: boolean;
  briefingCompulsoryKnown: boolean;
  briefingDate?: Date | null;
  briefingAttendanceEvidence?: boolean;
  documentCount: number;
  hasOemRequirement?: boolean;
  closingAt: Date;
  now?: Date;
};

export type NextActionResult = {
  action: NextAction;
  reason: string;
  priority: number; // higher = more urgent on dashboard
};

export function determineNextAction(input: NextActionInput): NextActionResult {
  const now = input.now ?? new Date();
  const deadline = evaluateDeadline(input.closingAt, now);

  if (input.status === "NO_BID" || input.status === "CANCELLED") {
    return { action: "AWAIT_DEADLINE", reason: "Opportunity closed operationally", priority: 0 };
  }

  if (input.hardNoBid || input.qualificationGate === "RED") {
    return {
      action: "NO_BID",
      reason: "Hard disqualifier or RED qualification — record NO BID or Founder override",
      priority: 100,
    };
  }

  if (deadline.isClosed) {
    return {
      action: "NO_BID",
      reason: "Deadline passed",
      priority: 100,
    };
  }

  if (
    input.briefingCompulsoryKnown &&
    input.briefingCompulsory &&
    !input.briefingAttendanceEvidence
  ) {
    return {
      action: "VERIFY_COMPULSORY_BRIEFING",
      reason: "Compulsory briefing requires verification",
      priority: 95,
    };
  }

  if (input.documentCount === 0 || input.status === "NEW") {
    return {
      action: "REVIEW_DOCUMENTS",
      reason: "Review source documents and confirm requirements",
      priority: deadline.hoursRemaining < 72 ? 90 : 70,
    };
  }

  if (input.hasOemRequirement) {
    return {
      action: "VERIFY_LICENCE",
      reason: "OEM / authorisation requirement must be verified",
      priority: 85,
    };
  }

  if (!input.selectedCompanyId) {
    return {
      action: "SELECT_BIDDING_COMPANY",
      reason: "Select eligible bidding company before sourcing",
      priority: 80,
    };
  }

  if (input.qualificationGate === "UNREVIEWED" || input.qualificationGate === "AMBER") {
    return {
      action: "MANUAL_REVIEW",
      reason: "Qualification needs operator review",
      priority: 75,
    };
  }

  if (input.status === "FOUNDER_REVIEW") {
    return {
      action: "FOUNDERS_REVIEW",
      reason: "Awaiting Founder approval",
      priority: 88,
    };
  }

  if (["COMPLIANCE", "PRICING"].includes(input.status)) {
    return {
      action: "COMPLETE_COMPLIANCE",
      reason: "Complete compliance / pricing gates",
      priority: 70,
    };
  }

  if (
    input.qualificationGate === "GREEN" &&
    ["QUALIFIED", "REVIEW", "SOURCING"].includes(input.status)
  ) {
    return {
      action: input.status === "SOURCING" ? "SOURCE_SUPPLIERS" : "READY_FOR_SOURCING",
      reason: "Qualified — proceed to supplier sourcing",
      priority: 65,
    };
  }

  if (input.classification && input.classification !== "SUPPLY_AND_DELIVER") {
    return {
      action: "MANUAL_REVIEW",
      reason: "Non supply-and-deliver — confirm strategic fit",
      priority: 60,
    };
  }

  return {
    action: "REVIEW_DOCUMENTS",
    reason: "Continue document and requirement review",
    priority: 50,
  };
}
