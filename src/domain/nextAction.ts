import type { OpportunityClass } from "./classification";
import type { PipelineStatus } from "./status";
import { evaluateDeadline } from "./deadlines";

export const NEXT_ACTIONS = [
  "DOWNLOAD_DOCUMENTS",
  "REVIEW_DOCUMENTS",
  "VERIFY_EXTRACTION",
  "VERIFY_COMPULSORY_BRIEFING",
  "SELECT_BIDDING_COMPANY",
  "SOURCE_SUPPLIERS",
  "REQUEST_QUOTES",
  "AWAIT_QUOTES",
  "COMPARE_QUOTES",
  "VERIFY_PRODUCT_MATCH",
  "CALCULATE_LOGISTICS",
  "REVIEW_PRICING",
  "VERIFY_WORKING_CAPITAL",
  "VERIFY_OEM_AUTHORIZATION",
  "VERIFY_LICENCE",
  "CONFIRM_DELIVERY",
  "READY_FOR_COMMERCIAL_REVIEW",
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
  commercialGate?: "GREEN" | "AMBER" | "RED" | "UNREVIEWED" | null;
  hardNoBid: boolean;
  classification?: OpportunityClass | null;
  selectedCompanyId?: string | null;
  briefingCompulsory: boolean;
  briefingCompulsoryKnown: boolean;
  briefingDate?: Date | null;
  briefingAttendanceEvidence?: boolean;
  documentCount: number;
  documentsDownloaded?: boolean;
  extractionDone?: boolean;
  extractionVerified?: boolean;
  lineItemCount?: number;
  supplierCount?: number;
  enquiryDraftCount?: number;
  quoteCount?: number;
  hasSupplierQuote?: boolean;
  pricingComplete?: boolean;
  productMatchVerified?: boolean;
  logisticsCalculated?: boolean;
  hasOemRequirement?: boolean;
  oemVerified?: boolean;
  closingAt: Date;
  now?: Date;
};

export type NextActionResult = {
  action: NextAction;
  reason: string;
  priority: number;
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
      reason: "Hard disqualifier or RED qualification",
      priority: 100,
    };
  }

  if (deadline.isClosed) {
    return { action: "NO_BID", reason: "Deadline passed", priority: 100 };
  }

  if (input.documentCount === 0) {
    return {
      action: "DOWNLOAD_DOCUMENTS",
      reason: "No source documents available",
      priority: 95,
    };
  }

  if (!input.documentsDownloaded) {
    return {
      action: "DOWNLOAD_DOCUMENTS",
      reason: "Retrieve and store source RFQ documents",
      priority: 94,
    };
  }

  if (!input.extractionDone || (input.lineItemCount ?? 0) === 0) {
    return {
      action: "REVIEW_DOCUMENTS",
      reason: "Extract and review line items from source documents",
      priority: 92,
    };
  }

  if (!input.extractionVerified) {
    return {
      action: "VERIFY_EXTRACTION",
      reason: "Critical extracted values remain UNVERIFIED",
      priority: 90,
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
      priority: 89,
    };
  }

  if (input.hasOemRequirement && !input.oemVerified) {
    return {
      action: "VERIFY_OEM_AUTHORIZATION",
      reason: "OEM / authorised status must be assessed (not automatic NO BID)",
      priority: 88,
    };
  }

  if (!input.selectedCompanyId) {
    return {
      action: "SELECT_BIDDING_COMPANY",
      reason: "Select bidding company before commercial finalisation",
      priority: 86,
    };
  }

  if ((input.supplierCount ?? 0) === 0) {
    return {
      action: "SOURCE_SUPPLIERS",
      reason: "Identify real suppliers for required products",
      priority: 84,
    };
  }

  if ((input.enquiryDraftCount ?? 0) === 0) {
    return {
      action: "REQUEST_QUOTES",
      reason: "Prepare supplier RFQ drafts (DRAFT_NOT_SENT)",
      priority: 82,
    };
  }

  if ((input.quoteCount ?? 0) === 0) {
    return {
      action: "AWAIT_QUOTES",
      reason: "No quote/price evidence recorded yet",
      priority: 80,
    };
  }

  if (!input.productMatchVerified) {
    return {
      action: "VERIFY_PRODUCT_MATCH",
      reason: "Verify supplier products against RFQ specifications",
      priority: 78,
    };
  }

  if ((input.quoteCount ?? 0) > 0 && !input.pricingComplete) {
    return {
      action: "COMPARE_QUOTES",
      reason: "Compare quotes and select sourcing mix",
      priority: 76,
    };
  }

  if (!input.logisticsCalculated) {
    return {
      action: "CALCULATE_LOGISTICS",
      reason: "Include delivery/logistics in landed cost",
      priority: 74,
    };
  }

  if (!input.pricingComplete) {
    return {
      action: "REVIEW_PRICING",
      reason: "Complete markup, margin and bid price scenario",
      priority: 72,
    };
  }

  if (input.commercialGate === "AMBER" || input.commercialGate === "UNREVIEWED") {
    return {
      action: "VERIFY_WORKING_CAPITAL",
      reason: "Review working capital and commercial gate before Founder review",
      priority: 70,
    };
  }

  if (input.status === "FOUNDER_REVIEW" || input.commercialGate === "GREEN") {
    return {
      action: "READY_FOR_COMMERCIAL_REVIEW",
      reason: "Commercial pack ready for Founder review",
      priority: 68,
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
    action: "READY_FOR_COMMERCIAL_REVIEW",
    reason: "Proceed to Founder commercial review",
    priority: 50,
  };
}
