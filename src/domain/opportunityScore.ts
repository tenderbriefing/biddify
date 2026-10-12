import type { OpportunityClass } from "./classification";
import { evaluateDeadline } from "./deadlines";

export type ScoreComponent = {
  key: string;
  label: string;
  score: number; // 0-100
  weight: number;
  explanation: string;
};

export type OpportunityScoreInput = {
  classification: OpportunityClass;
  classificationConfidence: number;
  closingAt: Date;
  closingTimeKnown: boolean;
  now?: Date;
  specificationClarity: "CLEAR" | "INCOMPLETE" | "AMBIGUOUS" | "UNKNOWN";
  complianceFeasibility: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  supplierFeasibility: "LIKELY" | "SPECIALIST" | "UNKNOWN";
  deliveryComplexity: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  submissionMethod: "EMAIL" | "PORTAL" | "ETENDER" | "PHYSICAL" | "OTHER" | "UNKNOWN";
  capitalRequirement: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  /** Only strengthen commercial component when real supplier pricing exists. */
  hasSupplierPricing?: boolean;
  expectedMarginPercent?: number | null;
};

export type OpportunityScoreResult = {
  total: number;
  components: ScoreComponent[];
  notes: string;
};

/**
 * Transparent initial opportunity score. No black-box AI.
 * Commercial margin is lightly weighted unless supplier pricing exists.
 */
export function scoreOpportunity(
  input: OpportunityScoreInput,
): OpportunityScoreResult {
  const now = input.now ?? new Date();
  const deadline = evaluateDeadline(input.closingAt, now);
  const components: ScoreComponent[] = [];

  // Supply-and-deliver fit
  let fit = 40;
  let fitWhy = "Not supply-and-deliver";
  if (input.classification === "SUPPLY_AND_DELIVER") {
    fit = Math.round(70 + input.classificationConfidence * 30);
    fitWhy = "Supply-and-deliver fit";
  } else if (input.classification === "ICT") {
    fit = 55;
    fitWhy = "ICT — may include goods but not pure S&D";
  }
  components.push({
    key: "supply_fit",
    label: "Supply-and-deliver fit",
    score: fit,
    weight: 0.25,
    explanation: fitWhy,
  });

  // Deadline feasibility
  let deadlineScore = 20;
  let deadlineWhy = "Closed or unknown";
  if (!deadline.isClosed) {
    if (deadline.hoursRemaining >= 7 * 24) {
      deadlineScore = 95;
      deadlineWhy = "≥7 days remaining";
    } else if (deadline.hoursRemaining >= 72) {
      deadlineScore = 80;
      deadlineWhy = "≥72 hours remaining";
    } else if (deadline.hoursRemaining >= 48) {
      deadlineScore = 60;
      deadlineWhy = "48–72 hours remaining";
    } else if (deadline.hoursRemaining >= 24) {
      deadlineScore = 40;
      deadlineWhy = "24–48 hours remaining";
    } else {
      deadlineScore = 20;
      deadlineWhy = "<24 hours remaining";
    }
  }
  if (!input.closingTimeKnown) {
    deadlineScore = Math.max(0, deadlineScore - 10);
    deadlineWhy += "; closing time UNKNOWN";
  }
  components.push({
    key: "deadline",
    label: "Deadline feasibility",
    score: deadlineScore,
    weight: 0.2,
    explanation: deadlineWhy,
  });

  const specMap = {
    CLEAR: 90,
    INCOMPLETE: 40,
    AMBIGUOUS: 30,
    UNKNOWN: 45,
  } as const;
  components.push({
    key: "spec",
    label: "Specification clarity",
    score: specMap[input.specificationClarity],
    weight: 0.15,
    explanation: `Specification clarity: ${input.specificationClarity}`,
  });

  const complianceMap = {
    HIGH: 85,
    MEDIUM: 60,
    LOW: 30,
    UNKNOWN: 45,
  } as const;
  components.push({
    key: "compliance",
    label: "Compliance feasibility",
    score: complianceMap[input.complianceFeasibility],
    weight: 0.1,
    explanation: `Compliance feasibility: ${input.complianceFeasibility}`,
  });

  const supplierMap = {
    LIKELY: 85,
    SPECIALIST: 45,
    UNKNOWN: 50,
  } as const;
  components.push({
    key: "supplier",
    label: "Supplier feasibility",
    score: supplierMap[input.supplierFeasibility],
    weight: 0.12,
    explanation: `Supplier feasibility: ${input.supplierFeasibility}`,
  });

  const deliveryMap = {
    LOW: 85,
    MEDIUM: 60,
    HIGH: 30,
    UNKNOWN: 50,
  } as const;
  components.push({
    key: "delivery",
    label: "Delivery complexity",
    score: deliveryMap[input.deliveryComplexity],
    weight: 0.08,
    explanation: `Delivery complexity: ${input.deliveryComplexity}`,
  });

  const submissionMap = {
    EMAIL: 90,
    PORTAL: 70,
    ETENDER: 65,
    PHYSICAL: 40,
    OTHER: 50,
    UNKNOWN: 35,
  } as const;
  components.push({
    key: "submission",
    label: "Submission simplicity",
    score: submissionMap[input.submissionMethod],
    weight: 0.07,
    explanation: `Submission: ${input.submissionMethod}`,
  });

  const capitalMap = {
    LOW: 85,
    MEDIUM: 60,
    HIGH: 30,
    UNKNOWN: 50,
  } as const;
  components.push({
    key: "capital",
    label: "Capital intensity",
    score: capitalMap[input.capitalRequirement],
    weight: 0.03,
    explanation: `Capital: ${input.capitalRequirement}`,
  });

  // Commercial — muted unless pricing exists
  let commercial = 50;
  let commercialWhy =
    "No supplier pricing yet — commercial score held neutral";
  let commercialWeight = 0;
  if (input.hasSupplierPricing && input.expectedMarginPercent != null) {
    commercialWeight = 0.1;
    if (input.expectedMarginPercent >= 16) commercial = 90;
    else if (input.expectedMarginPercent >= 12) commercial = 70;
    else if (input.expectedMarginPercent >= 8) commercial = 45;
    else commercial = 20;
    commercialWhy = `Margin ${input.expectedMarginPercent}% from supplier pricing`;
  }
  components.push({
    key: "commercial",
    label: "Commercial (pricing-backed)",
    score: commercial,
    weight: commercialWeight,
    explanation: commercialWhy,
  });

  const weightSum = components.reduce((s, c) => s + c.weight, 0) || 1;
  const total = Math.round(
    components.reduce((s, c) => s + c.score * (c.weight / weightSum), 0),
  );

  return {
    total,
    components,
    notes: components.map((c) => `${c.label}: ${c.score} (${c.explanation})`).join(" | "),
  };
}
