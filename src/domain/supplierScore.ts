export type SupplierScoreInput = {
  relevance: number; // 0-100
  responseRate: number | null; // null = insufficient history
  responseSpeedScore: number | null;
  priceCompetitiveness: number | null;
  specMatchScore: number | null;
  deliveryReliability: number | null;
  quoteQuality: number | null;
  sampleSize: number;
};

export type SupplierScoreResult = {
  total: number | null;
  components: Record<string, number | "INSUFFICIENT_HISTORY">;
  reasons: string[];
};

/**
 * Transparent supplier score. New suppliers show insufficient history — never invent performance.
 */
export function calculateSupplierScore(
  input: SupplierScoreInput,
): SupplierScoreResult {
  const reasons: string[] = [];
  const components: SupplierScoreResult["components"] = {
    RELEVANCE: input.relevance,
  };

  if (input.sampleSize < 3) {
    reasons.push(
      `Insufficient history (n=${input.sampleSize}) — performance components not invented`,
    );
    for (const key of [
      "RESPONSE_RATE",
      "RESPONSE_SPEED",
      "PRICE_COMPETITIVENESS",
      "SPECIFICATION_MATCH",
      "DELIVERY_RELIABILITY",
      "QUOTE_QUALITY",
    ]) {
      components[key] = "INSUFFICIENT_HISTORY";
    }
    return {
      total: null,
      components,
      reasons: [
        ...reasons,
        `Relevance only: ${input.relevance}/100 until history accumulates`,
      ],
    };
  }

  const pairs: Array<[string, number | null]> = [
    ["RESPONSE_RATE", input.responseRate],
    ["RESPONSE_SPEED", input.responseSpeedScore],
    ["PRICE_COMPETITIVENESS", input.priceCompetitiveness],
    ["SPECIFICATION_MATCH", input.specMatchScore],
    ["DELIVERY_RELIABILITY", input.deliveryReliability],
    ["QUOTE_QUALITY", input.quoteQuality],
  ];
  const values = [input.relevance];
  for (const [key, val] of pairs) {
    if (val == null) {
      components[key] = "INSUFFICIENT_HISTORY";
    } else {
      components[key] = val;
      values.push(val);
    }
  }
  const total = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  reasons.push(`Averaged ${values.length} known components`);
  return { total, components, reasons };
}
