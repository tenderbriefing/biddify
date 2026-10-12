import {
  classifyOpportunity,
  type ClassificationInput,
  type OpportunityClass,
} from "./classification";

/**
 * Autonomous Supply & Deliver classifier.
 * Extends heuristic classification with MIXED / UNKNOWN handling.
 * Only SUPPLY_AND_DELIVER proceeds automatically in V1.
 */

export type SupplyDeliverClass =
  | "SUPPLY_AND_DELIVER"
  | "SERVICES"
  | "CONSTRUCTION"
  | "CONSULTING"
  | "MIXED"
  | "UNKNOWN";

export type SupplyDeliverClassificationInput = ClassificationInput & {
  documentTextHints?: string[];
  boqLineCount?: number;
  hasPricingSchedule?: boolean;
  hasServiceLanguageInDocs?: boolean;
  hasConstructionLanguageInDocs?: boolean;
};

export type SupplyDeliverClassificationResult = {
  classification: SupplyDeliverClass;
  confidence: number;
  reason: string;
  evidence: string[];
  /** Maps onto OpportunityClass for persistence where possible. */
  opportunityClass: OpportunityClass;
  proceedsAutomatically: boolean;
};

const MIXED_HINT =
  /\b(supply\s+and\s+(?:install|commission)|goods\s+and\s+services|supply\s+and\s+maintain)\b/i;

/**
 * Classify for autonomous V1 gate.
 * Do not invent; uncertain → UNKNOWN or MIXED → REVIEW_REQUIRED path.
 */
export function classifySupplyAndDeliver(
  input: SupplyDeliverClassificationInput,
): SupplyDeliverClassificationResult {
  const evidence: string[] = [];
  const base = classifyOpportunity({
    title: input.title,
    description: input.description,
    category: input.category,
    procurementMethod: input.procurementMethod,
    mainProcurementCategory: input.mainProcurementCategory,
  });

  evidence.push(`Heuristic: ${base.classification} (${base.confidence.toFixed(2)})`);
  evidence.push(base.reasoning);

  const docBlob = (input.documentTextHints ?? []).join(" ");
  if (docBlob) {
    evidence.push(`Document text inspected (${docBlob.length} chars)`);
  }
  if (input.boqLineCount != null) {
    evidence.push(`BOQ lines available: ${input.boqLineCount}`);
  }
  if (input.hasPricingSchedule) {
    evidence.push("Pricing schedule / BOQ present");
  }

  const mixedFromTitle = MIXED_HINT.test(
    [input.title, input.description ?? ""].join(" "),
  );
  const mixedFromDocs =
    Boolean(input.hasServiceLanguageInDocs) &&
    (base.effective === "SUPPLY_AND_DELIVER" || Boolean(input.hasPricingSchedule));
  const constructionInDocs = Boolean(input.hasConstructionLanguageInDocs);

  if (mixedFromTitle || mixedFromDocs) {
    return {
      classification: "MIXED",
      confidence: 0.7,
      reason:
        "Mixed goods/services signals — autonomous V1 requires Founder review",
      evidence: [
        ...evidence,
        mixedFromTitle
          ? "Title/description indicates supply+install/maintain"
          : "Documents combine supply and services language",
      ],
      opportunityClass: "MIXED",
      proceedsAutomatically: false,
    };
  }

  if (constructionInDocs && base.effective !== "SUPPLY_AND_DELIVER") {
    return {
      classification: "CONSTRUCTION",
      confidence: Math.max(base.confidence, 0.75),
      reason: "Construction language in documents — skip autonomous pricing",
      evidence: [...evidence, "Construction signals in attached documents"],
      opportunityClass: "CONSTRUCTION",
      proceedsAutomatically: false,
    };
  }

  if (base.effective === "SUPPLY_AND_DELIVER") {
    const lowConfidence = base.confidence < 0.55;
    if (lowConfidence && (input.boqLineCount ?? 0) === 0 && !input.hasPricingSchedule) {
      return {
        classification: "UNKNOWN",
        confidence: base.confidence,
        reason:
          "Supply signals weak and no BOQ/pricing schedule — escalate for review",
        evidence: [...evidence, "Insufficient BOQ evidence for auto-proceed"],
        opportunityClass: "UNKNOWN",
        proceedsAutomatically: false,
      };
    }
    return {
      classification: "SUPPLY_AND_DELIVER",
      confidence: base.confidence,
      reason: base.reasoning,
      evidence,
      opportunityClass: "SUPPLY_AND_DELIVER",
      proceedsAutomatically: true,
    };
  }

  if (
    base.effective === "SERVICES" ||
    base.effective === "CONSTRUCTION" ||
    base.effective === "CONSULTING"
  ) {
    const mapped = base.effective as SupplyDeliverClass;
    return {
      classification: mapped,
      confidence: base.confidence,
      reason: `Non-supply class ${mapped} — recorded and skipped for V1`,
      evidence,
      opportunityClass: base.effective,
      proceedsAutomatically: false,
    };
  }

  if (base.confidence < 0.5) {
    return {
      classification: "UNKNOWN",
      confidence: base.confidence,
      reason: "Classification uncertain — REVIEW_REQUIRED path",
      evidence,
      opportunityClass: "UNKNOWN",
      proceedsAutomatically: false,
    };
  }

  return {
    classification: "UNKNOWN",
    confidence: base.confidence,
    reason: `Class ${base.effective} is outside autonomous Supply & Deliver V1`,
    evidence,
    opportunityClass:
      base.effective === "OTHER" ? "UNKNOWN" : base.effective,
    proceedsAutomatically: false,
  };
}
