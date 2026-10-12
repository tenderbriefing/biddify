export const QUOTE_EVIDENCE_TYPES = [
  "SUPPLIER_QUOTE",
  "PUBLIC_PRICE_REFERENCE",
  "MANUAL_ESTIMATE",
  "HISTORICAL_PRICE",
  "UNKNOWN",
] as const;

export type QuoteEvidenceType = (typeof QUOTE_EVIDENCE_TYPES)[number];

const RANK: Record<QuoteEvidenceType, number> = {
  SUPPLIER_QUOTE: 4,
  HISTORICAL_PRICE: 3,
  PUBLIC_PRICE_REFERENCE: 2,
  MANUAL_ESTIMATE: 1,
  UNKNOWN: 0,
};

export function bestEvidenceType(
  types: QuoteEvidenceType[],
): QuoteEvidenceType {
  if (types.length === 0) return "UNKNOWN";
  return types.reduce((best, t) => (RANK[t] > RANK[best] ? t : best), "UNKNOWN");
}

export function isSupplierQuotation(type: QuoteEvidenceType): boolean {
  return type === "SUPPLIER_QUOTE";
}

export function evidenceLabel(type: QuoteEvidenceType): string {
  switch (type) {
    case "SUPPLIER_QUOTE":
      return "Supplier quotation";
    case "PUBLIC_PRICE_REFERENCE":
      return "Public price reference (NOT a supplier quotation)";
    case "MANUAL_ESTIMATE":
      return "Manual estimate";
    case "HISTORICAL_PRICE":
      return "Historical price";
    default:
      return "Unknown evidence";
  }
}
