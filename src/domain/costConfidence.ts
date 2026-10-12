import type { QuoteEvidenceType } from "./quoteEvidence";

export type CostConfidenceInput = {
  evidenceTypes: QuoteEvidenceType[];
  independentSupplierCount: number;
  quoteAgeDays: number | null;
  specMatchKnown: boolean;
  stockConfirmed: boolean;
  deliveryConfirmed: boolean;
  vatClarity: boolean;
  leadTimeClarity: boolean;
};

export type CostConfidenceResult = {
  score: number;
  reasons: string[];
};

const EVIDENCE_WEIGHT: Record<QuoteEvidenceType, number> = {
  SUPPLIER_QUOTE: 55,
  HISTORICAL_PRICE: 25,
  PUBLIC_PRICE_REFERENCE: 20,
  MANUAL_ESTIMATE: 10,
  UNKNOWN: 0,
};

export function calculateCostConfidence(
  input: CostConfidenceInput,
): CostConfidenceResult {
  const reasons: string[] = [];
  let score = 0;

  const best = input.evidenceTypes.reduce(
    (acc, t) => (EVIDENCE_WEIGHT[t] > EVIDENCE_WEIGHT[acc] ? t : acc),
    "UNKNOWN" as QuoteEvidenceType,
  );
  score += EVIDENCE_WEIGHT[best];
  reasons.push(`Best evidence: ${best} (+${EVIDENCE_WEIGHT[best]})`);

  if (input.independentSupplierCount >= 2) {
    score += 15;
    reasons.push("≥2 independent supplier evidence sources (+15)");
  } else if (input.independentSupplierCount === 1) {
    score += 5;
    reasons.push("Single supplier evidence source (+5)");
  }

  if (input.quoteAgeDays != null && input.quoteAgeDays <= 14) {
    score += 10;
    reasons.push("Quote age ≤14 days (+10)");
  } else if (input.quoteAgeDays != null && input.quoteAgeDays > 60) {
    score -= 10;
    reasons.push("Quote age >60 days (−10)");
  }

  if (input.specMatchKnown) {
    score += 5;
    reasons.push("Spec match assessed (+5)");
  }
  if (input.stockConfirmed) {
    score += 5;
    reasons.push("Stock confirmed (+5)");
  }
  if (input.deliveryConfirmed) {
    score += 5;
    reasons.push("Delivery confirmed (+5)");
  }
  if (input.vatClarity) {
    score += 3;
    reasons.push("VAT clarity (+3)");
  }
  if (input.leadTimeClarity) {
    score += 2;
    reasons.push("Lead-time clarity (+2)");
  }

  if (best === "PUBLIC_PRICE_REFERENCE" || best === "MANUAL_ESTIMATE") {
    reasons.push("Public/manual evidence alone cannot normally produce GREEN");
  }

  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}

export function calculateSpecConfidence(input: {
  matches: Array<"EXACT_MATCH" | "COMPLIANT_EQUIVALENT" | "POSSIBLE_MATCH" | "NON_COMPLIANT" | "UNKNOWN">;
}): CostConfidenceResult {
  if (input.matches.length === 0) {
    return { score: 0, reasons: ["No product matches assessed"] };
  }
  if (input.matches.some((m) => m === "NON_COMPLIANT")) {
    return { score: 0, reasons: ["At least one NON_COMPLIANT product match"] };
  }
  const ranks = input.matches.map((m) => {
    switch (m) {
      case "EXACT_MATCH":
        return 100;
      case "COMPLIANT_EQUIVALENT":
        return 80;
      case "POSSIBLE_MATCH":
        return 40;
      case "UNKNOWN":
        return 20;
      default:
        return 0;
    }
  });
  const score = Math.round(
    ranks.reduce((a: number, b: number) => a + b, 0) / ranks.length,
  );
  return {
    score,
    reasons: [`Average match quality across ${ranks.length} line(s)`],
  };
}
