/**
 * Answers the Founder's 12 operating questions for a BID workspace.
 * Uses only persisted application data — never fabricates quotes or sends.
 */

export type FounderReviewQuestion = {
  id: number;
  question: string;
  answer: string;
  status: "ANSWERED" | "PARTIAL" | "UNKNOWN" | "BLOCKED";
};

export type FounderReviewPackInput = {
  internalId: string;
  title: string;
  buyer: string;
  closingDisplay: string;
  hoursRemaining: number;
  isClosed: boolean;
  classification?: string | null;
  eligibilityVerdict?: string | null;
  eligibilityExplanation?: string | null;
  selectedCompanyName?: string | null;
  recommendedCompanyName?: string | null;
  companyOverride?: boolean;
  lineItems: Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    brandRequirement?: string | null;
  }>;
  suppliers: Array<{
    name: string;
    email?: string | null;
    lifecycleStatus?: string | null;
  }>;
  landedCost?: number | null;
  sellingPrice?: number | null;
  grossProfit?: number | null;
  grossMarginPercent?: number | null;
  markupPercent?: number | null;
  vatRegistered?: boolean | null;
  evidenceQuality?: string | null;
  complianceBlocking: string[];
  complianceComplete: string[];
  nextAction?: string | null;
  nextActionReason?: string | null;
  pipelineStatus: string;
  emailTransport: "PENDING_EMAIL_INTEGRATION";
};

export type FounderReviewPack = {
  bidId: string;
  readyForFounderReview: boolean;
  readyToSubmit: boolean;
  questions: FounderReviewQuestion[];
  whatFounderMustDoNext: string[];
};

export function buildFounderReviewPack(
  input: FounderReviewPackInput,
): FounderReviewPack {
  const itemsSummary =
    input.lineItems.length === 0
      ? "No BOQ lines extracted yet"
      : input.lineItems
          .map(
            (l) =>
              `${l.lineNumber}. ${l.description} × ${l.quantity} ${l.unit}` +
              (l.brandRequirement ? ` [${l.brandRequirement}]` : ""),
          )
          .join("; ");

  const supplierSummary =
    input.suppliers.length === 0
      ? "No suppliers identified"
      : input.suppliers
          .map(
            (s) =>
              `${s.name}${s.email ? ` <${s.email}>` : ""} (${s.lifecycleStatus ?? "DRAFT"})`,
          )
          .join("; ");

  const hasCost =
    input.landedCost != null && Number.isFinite(Number(input.landedCost));
  const hasPrice =
    input.sellingPrice != null && Number.isFinite(Number(input.sellingPrice));

  const questions: FounderReviewQuestion[] = [
    {
      id: 1,
      question: "What is being purchased?",
      answer: input.title,
      status: input.title ? "ANSWERED" : "UNKNOWN",
    },
    {
      id: 2,
      question: "When does it close?",
      answer: input.isClosed
        ? `CLOSED — was ${input.closingDisplay}`
        : `${input.closingDisplay} (${input.hoursRemaining.toFixed(1)}h remaining)`,
      status: input.isClosed ? "BLOCKED" : "ANSWERED",
    },
    {
      id: 3,
      question: "Can we bid?",
      answer: input.eligibilityVerdict
        ? `${input.eligibilityVerdict}${input.eligibilityExplanation ? ` — ${input.eligibilityExplanation}` : ""}`
        : "Eligibility not yet evaluated",
      status:
        input.eligibilityVerdict === "NOT_ELIGIBLE"
          ? "BLOCKED"
          : input.eligibilityVerdict
            ? input.eligibilityVerdict === "ELIGIBLE"
              ? "ANSWERED"
              : "PARTIAL"
            : "UNKNOWN",
    },
    {
      id: 4,
      question: "Which company should bid?",
      answer: input.selectedCompanyName
        ? `${input.selectedCompanyName}${
            input.recommendedCompanyName &&
            input.recommendedCompanyName !== input.selectedCompanyName
              ? ` (recommended was ${input.recommendedCompanyName}${input.companyOverride ? "; Founder override recorded" : ""})`
              : ""
          }`
        : "No bidding company selected",
      status: input.selectedCompanyName ? "ANSWERED" : "BLOCKED",
    },
    {
      id: 5,
      question: "What exactly must we supply?",
      answer: itemsSummary,
      status: input.lineItems.length ? "ANSWERED" : "UNKNOWN",
    },
    {
      id: 6,
      question: "Where can we buy it?",
      answer: `${supplierSummary}. Email transport: ${input.emailTransport} — drafts only, not sent.`,
      status: input.suppliers.length ? "PARTIAL" : "UNKNOWN",
    },
    {
      id: 7,
      question: "What will it cost us?",
      answer: hasCost
        ? `Landed cost R ${Number(input.landedCost).toFixed(2)} (evidence: ${input.evidenceQuality ?? "unspecified"})`
        : "Cost not yet established — formal supplier quotes still required for high confidence",
      status: hasCost
        ? input.evidenceQuality === "SUPPLIER_QUOTE"
          ? "ANSWERED"
          : "PARTIAL"
        : "UNKNOWN",
    },
    {
      id: 8,
      question: "What should we quote?",
      answer: hasPrice
        ? `Selling price R ${Number(input.sellingPrice).toFixed(2)} at ${input.markupPercent ?? "—"}% markup` +
          (input.vatRegistered === false
            ? " — company not VAT-registered; do not present as VAT charged by bidder"
            : input.vatRegistered
              ? " — VAT treatment per company registration"
              : "")
        : "No selling price calculated yet",
      status: hasPrice ? "PARTIAL" : "UNKNOWN",
    },
    {
      id: 9,
      question: "How much profit will we make?",
      answer:
        hasPrice && input.grossProfit != null
          ? `Gross profit R ${Number(input.grossProfit).toFixed(2)} · Gross margin ${Number(input.grossMarginPercent ?? 0).toFixed(2)}% (margin ≠ markup)`
          : "Profit not calculable until cost and selling price exist",
      status:
        hasPrice && input.grossProfit != null ? "PARTIAL" : "UNKNOWN",
    },
    {
      id: 10,
      question: "What documents are missing?",
      answer:
        input.complianceBlocking.length === 0
          ? input.complianceComplete.length
            ? `No mandatory blockers · complete/available: ${input.complianceComplete.join(", ")}`
            : "Compliance checklist not generated"
          : input.complianceBlocking.join("; "),
      status:
        input.complianceBlocking.length === 0
          ? input.complianceComplete.length
            ? "ANSWERED"
            : "UNKNOWN"
          : "PARTIAL",
    },
    {
      id: 11,
      question: "Is the bid ready for my review?",
      answer:
        input.pipelineStatus === "FOUNDER_REVIEW"
          ? "YES — status FOUNDER_REVIEW"
          : `Not yet — pipeline is ${input.pipelineStatus}; next: ${input.nextAction ?? "—"} (${input.nextActionReason ?? ""})`,
      status:
        input.pipelineStatus === "FOUNDER_REVIEW" ? "ANSWERED" : "PARTIAL",
    },
    {
      id: 12,
      question: "What exactly must I do next?",
      answer: "", // filled below
      status: "PARTIAL",
    },
  ];

  const whatFounderMustDoNext: string[] = [];
  if (input.isClosed) {
    whatFounderMustDoNext.push("Deadline passed — record NO_BID or late override with evidence");
  }
  if (!input.selectedCompanyName) {
    whatFounderMustDoNext.push("Select / confirm bidding company");
  }
  if (input.eligibilityVerdict === "ELIGIBLE_WITH_WARNING") {
    whatFounderMustDoNext.push("Accept or reject eligibility warnings before submission");
  }
  if (!hasCost || input.evidenceQuality !== "SUPPLIER_QUOTE") {
    whatFounderMustDoNext.push(
      "Capture formal supplier quotations (manual upload OK — email integration pending)",
    );
  }
  for (const b of input.complianceBlocking.slice(0, 8)) {
    whatFounderMustDoNext.push(`Resolve compliance: ${b}`);
  }
  if (input.pipelineStatus === "FOUNDER_REVIEW") {
    whatFounderMustDoNext.push(
      "Review commercial numbers and compliance, then approve or send back — do not submit yet",
    );
  } else {
    whatFounderMustDoNext.push(
      `Advance workflow (${input.nextAction ?? input.pipelineStatus}) until FOUNDER_REVIEW`,
    );
  }
  whatFounderMustDoNext.push(
    "Do not send supplier emails or submit the government bid until Founder explicitly authorises",
  );

  questions[11] = {
    id: 12,
    question: "What exactly must I do next?",
    answer: whatFounderMustDoNext.join(" · "),
    status: whatFounderMustDoNext.length ? "ANSWERED" : "UNKNOWN",
  };

  const readyForFounderReview =
    Boolean(input.selectedCompanyName) &&
    input.lineItems.length > 0 &&
    hasPrice &&
    !input.isClosed &&
    input.eligibilityVerdict !== "NOT_ELIGIBLE";

  const readyToSubmit = false; // never true without Founder approval + full compliance

  return {
    bidId: input.internalId,
    readyForFounderReview:
      readyForFounderReview && input.pipelineStatus === "FOUNDER_REVIEW",
    readyToSubmit,
    questions,
    whatFounderMustDoNext,
  };
}
