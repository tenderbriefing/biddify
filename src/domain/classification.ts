export const OPPORTUNITY_CLASSES = [
  "SUPPLY_AND_DELIVER",
  "SERVICES",
  "CONSTRUCTION",
  "CONSULTING",
  "TRAINING",
  "ICT",
  "MIXED",
  "UNKNOWN",
  "OTHER",
] as const;

export type OpportunityClass = (typeof OPPORTUNITY_CLASSES)[number];

export type ClassificationSource = "HEURISTIC" | "MANUAL" | "AI";

export type ClassificationInput = {
  title: string;
  description?: string | null;
  category?: string | null;
  procurementMethod?: string | null;
  mainProcurementCategory?: string | null;
};

export type ClassificationResult = {
  classification: OpportunityClass;
  confidence: number;
  reasoning: string;
  source: ClassificationSource;
  /** Effective class after manual override, if any. */
  effective: OpportunityClass;
  override?: OpportunityClass | null;
};

const SUPPLY_PATTERNS =
  /\b(supply\s+and\s+deliver|supply\s*&\s*deliver|supply\s+and\s+delivery|supply\s+of|deliver(?:y)?\s+of|goods|stationery|consumables?|laptops?|desktops?|monitors?|printers?|furniture|ppe|cleaning\s+products?|hardware|building\s+materials|appliances?|tools?|equipment)\b/i;

const CONSTRUCTION_PATTERNS =
  /\b(construction|cidb|grading|civil\s+works|building\s+works|renovation|road\s+works|plumbing\s+installation)\b/i;

const CONSULTING_PATTERNS =
  /\b(consult(?:ing|ant)|professional\s+services|advisory|feasibility\s+study)\b/i;

const TRAINING_PATTERNS =
  /\b(training|workshop|skills\s+development|learnership|facilitation)\b/i;

const ICT_PATTERNS =
  /\b(software|licence|license|saas|cloud|system\s+development|ict\s+support|network(?:ing)?|server|cyber\s*security)\b/i;

const SERVICES_PATTERNS =
  /\b(appointment\s+of\s+a\s+service\s+provider|provision\s+of\s+services|maintenance|repair|hire\s+of|rental)\b/i;

/**
 * Transparent heuristic classifier. Uncertain results stay low-confidence.
 * Manual override never silently overwrites reasoning of the heuristic.
 */
export function classifyOpportunity(
  input: ClassificationInput,
  override?: OpportunityClass | null,
): ClassificationResult {
  const text = [
    input.title,
    input.description ?? "",
    input.category ?? "",
    input.procurementMethod ?? "",
    input.mainProcurementCategory ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const reasons: string[] = [];
  let classification: OpportunityClass = "OTHER";
  let confidence = 0.35;

  const goodsHint =
    (input.mainProcurementCategory || "").toLowerCase() === "goods" ||
    (input.category || "").toLowerCase() === "goods";

  if (CONSTRUCTION_PATTERNS.test(text)) {
    classification = "CONSTRUCTION";
    confidence = 0.8;
    reasons.push("Construction / grading language detected");
  } else if (CONSULTING_PATTERNS.test(text) && !SUPPLY_PATTERNS.test(text)) {
    classification = "CONSULTING";
    confidence = 0.75;
    reasons.push("Consulting / professional services language detected");
  } else if (TRAINING_PATTERNS.test(text) && !SUPPLY_PATTERNS.test(text)) {
    classification = "TRAINING";
    confidence = 0.75;
    reasons.push("Training language detected");
  } else if (
    SUPPLY_PATTERNS.test(text) ||
    (goodsHint && !SERVICES_PATTERNS.test(text))
  ) {
    classification = "SUPPLY_AND_DELIVER";
    confidence = SUPPLY_PATTERNS.test(text) ? 0.85 : 0.65;
    reasons.push(
      SUPPLY_PATTERNS.test(text)
        ? "Supply-and-deliver / goods language detected"
        : "OCDS mainProcurementCategory=goods without strong services language",
    );
    if (ICT_PATTERNS.test(text) && /\b(laptop|desktop|monitor|printer|hardware)\b/i.test(text)) {
      reasons.push("ICT goods present — still treated as supply-and-deliver goods");
    }
  } else if (ICT_PATTERNS.test(text)) {
    classification = "ICT";
    confidence = 0.7;
    reasons.push("ICT / software / systems language detected");
  } else if (SERVICES_PATTERNS.test(text) || (input.mainProcurementCategory || "").toLowerCase() === "services") {
    classification = "SERVICES";
    confidence = 0.7;
    reasons.push("Services language or OCDS category=services");
  } else {
    reasons.push("No strong classification signals — marked OTHER with low confidence");
  }

  const effective = override ?? classification;

  if (override && override !== classification) {
    reasons.push(
      `Manual override applied: ${override} (heuristic was ${classification})`,
    );
  }

  if (confidence < 0.5 && !override) {
    reasons.push("Low confidence — do not treat as fact without review");
  }

  return {
    classification,
    confidence,
    reasoning: reasons.join("; "),
    source: override ? "MANUAL" : "HEURISTIC",
    effective,
    override: override ?? null,
  };
}
