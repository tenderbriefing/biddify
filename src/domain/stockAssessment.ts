/**
 * Explicit stock / availability classification for procurement ranking.
 */

export const STOCK_CLASSES = [
  "IN_STOCK_CONFIRMED",
  "AVAILABLE_TO_ORDER",
  "LIMITED_STOCK",
  "OUT_OF_STOCK",
  "UNKNOWN",
] as const;

export type StockClass = (typeof STOCK_CLASSES)[number];

export type StockAssessment = {
  class: StockClass;
  availableQuantity: number | null;
  confidence: number;
  evidence: string;
  /** False when OUT_OF_STOCK — cannot win procurement. */
  eligibleToWin: boolean;
  /** Max units this candidate may supply (null = unconstrained if eligible). */
  maxSupplyUnits: number | null;
};

export function assessStock(input: {
  availabilityText?: string | null;
  stockStatus?: string | null;
  quantityHint?: number | null;
  pageText?: string | null;
}): StockAssessment {
  const text = [
    input.availabilityText ?? "",
    input.stockStatus ?? "",
    input.pageText ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (/out\s*of\s*stock|sold\s*out|unavailable|no\s*stock/i.test(text)) {
    return {
      class: "OUT_OF_STOCK",
      availableQuantity: 0,
      confidence: 0.9,
      evidence: "Page/status indicates out of stock",
      eligibleToWin: false,
      maxSupplyUnits: 0,
    };
  }

  const limited = text.match(
    /(?:only\s*)?(\d+)\s*(?:left|in\s*stock|available)|limited\s*stock/i,
  );
  if (limited) {
    const n =
      limited[1] != null
        ? Number(limited[1])
        : input.quantityHint != null
          ? input.quantityHint
          : null;
    return {
      class: "LIMITED_STOCK",
      availableQuantity: n,
      confidence: n != null ? 0.75 : 0.55,
      evidence:
        n != null
          ? `Limited stock evidence: ${n} units`
          : "Limited stock flagged without exact quantity",
      eligibleToWin: true,
      maxSupplyUnits: n,
    };
  }

  if (
    /in\s*stock|ships?\s*(today|tomorrow)|ready\s*to\s*ship|available\s*now/i.test(
      text,
    )
  ) {
    return {
      class: "IN_STOCK_CONFIRMED",
      availableQuantity: null,
      confidence: 0.85,
      evidence: "In-stock / ready-to-ship language on listing",
      eligibleToWin: true,
      maxSupplyUnits: null,
    };
  }

  if (
    /available\s*to\s*order|pre.?order|backorder|ships?\s*in\s*\d+/i.test(text)
  ) {
    return {
      class: "AVAILABLE_TO_ORDER",
      availableQuantity: null,
      confidence: 0.6,
      evidence: "Available to order / lead-time language",
      eligibleToWin: true,
      maxSupplyUnits: null,
    };
  }

  if (input.quantityHint != null && input.quantityHint > 0) {
    return {
      class: "LIMITED_STOCK",
      availableQuantity: input.quantityHint,
      confidence: 0.5,
      evidence: `Quantity hint ${input.quantityHint}`,
      eligibleToWin: true,
      maxSupplyUnits: input.quantityHint,
    };
  }

  return {
    class: "UNKNOWN",
    availableQuantity: null,
    confidence: 0.25,
    evidence: "No stock evidence found",
    eligibleToWin: true, // unknown does not hard-block; reduces confidence
    maxSupplyUnits: null,
  };
}
