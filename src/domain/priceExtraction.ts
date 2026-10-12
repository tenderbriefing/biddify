/**
 * Price extraction + VAT treatment for live product pages.
 * Do not invent; distinguish price types carefully.
 */

import { roundMoney, toNumber } from "./money";

export const PRICE_TYPES = [
  "NORMAL_PRICE",
  "SALE_PRICE",
  "BULK_PRICE",
  "MEMBER_PRICE",
  "FROM_PRICE",
  "PRICE_RANGE",
  "OUT_OF_STOCK_PRICE",
  "UNKNOWN_PRICE_TYPE",
] as const;

export type PriceType = (typeof PRICE_TYPES)[number];

export const VAT_TREATMENTS = [
  "VAT_INCLUSIVE",
  "VAT_EXCLUSIVE",
  "NON_VAT",
  "UNKNOWN",
] as const;

export type VatTreatment = (typeof VAT_TREATMENTS)[number];

export type ExtractedPrice = {
  rawObservedPrice: number | null;
  normalizedUsablePrice: number | null;
  priceType: PriceType;
  vatTreatment: VatTreatment;
  usableForAutonomousPricing: boolean;
  normalizationNotes: string[];
  riskFlags: string[];
};

export type PriceExtractionInput = {
  /** Raw currency amount parsed from page. */
  amount: number | null;
  /** Secondary sale amount if present. */
  saleAmount?: number | null;
  /** Text context near the price. */
  contextText?: string;
  outOfStock?: boolean;
  memberOnly?: boolean;
  fromPrice?: boolean;
  priceRange?: { min: number; max: number } | null;
};

/**
 * Decide usable price from observed page signals.
 */
export function extractUsablePrice(input: PriceExtractionInput): ExtractedPrice {
  const notes: string[] = [];
  const riskFlags: string[] = [];
  const ctx = (input.contextText ?? "").toLowerCase();

  let vatTreatment: VatTreatment = "UNKNOWN";
  if (/vat\s*incl|incl(?:usive)?\s*of\s*vat|including\s*vat/.test(ctx)) {
    vatTreatment = "VAT_INCLUSIVE";
  } else if (/vat\s*excl|excluding\s*vat|ex\s*vat|before\s*vat/.test(ctx)) {
    vatTreatment = "VAT_EXCLUSIVE";
  } else if (/zero.?rated|vat\s*free|no\s*vat/.test(ctx)) {
    vatTreatment = "NON_VAT";
  } else {
    notes.push("VAT treatment not determinable from page text");
  }

  if (input.outOfStock || /out\s*of\s*stock|unavailable/.test(ctx)) {
    return {
      rawObservedPrice: input.amount,
      normalizedUsablePrice: null,
      priceType: "OUT_OF_STOCK_PRICE",
      vatTreatment,
      usableForAutonomousPricing: false,
      normalizationNotes: [...notes, "Out-of-stock price not used"],
      riskFlags: ["OUT_OF_STOCK_PRICE"],
    };
  }

  if (input.priceRange) {
    return {
      rawObservedPrice: input.priceRange.min,
      normalizedUsablePrice: null,
      priceType: "PRICE_RANGE",
      vatTreatment,
      usableForAutonomousPricing: false,
      normalizationNotes: [
        ...notes,
        `Price range R${input.priceRange.min}–R${input.priceRange.max} — not auto-usable`,
      ],
      riskFlags: ["PRICE_RANGE"],
    };
  }

  if (input.fromPrice || /\bfrom\s*r?\s*\d/i.test(ctx)) {
    return {
      rawObservedPrice: input.amount,
      normalizedUsablePrice: null,
      priceType: "FROM_PRICE",
      vatTreatment,
      usableForAutonomousPricing: false,
      normalizationNotes: [...notes, '"From" price not used as firm unit price'],
      riskFlags: ["FROM_PRICE"],
    };
  }

  if (input.memberOnly || /member\s*price|loyalty\s*price|circle\s*price/.test(ctx)) {
    riskFlags.push("MEMBER_PRICE");
    return {
      rawObservedPrice: input.amount,
      normalizedUsablePrice: null,
      priceType: "MEMBER_PRICE",
      vatTreatment,
      usableForAutonomousPricing: false,
      normalizationNotes: [...notes, "Member-only price excluded without membership confirmation"],
      riskFlags,
    };
  }

  if (input.saleAmount != null && input.amount != null) {
    const sale = roundMoney(toNumber(input.saleAmount));
    notes.push(`Sale price R${sale} preferred over listed R${input.amount}`);
    riskFlags.push("SALE_PRICE");
    return {
      rawObservedPrice: sale,
      normalizedUsablePrice: sale,
      priceType: "SALE_PRICE",
      vatTreatment,
      usableForAutonomousPricing: true,
      normalizationNotes: notes,
      riskFlags,
    };
  }

  if (/bulk|case\s*price|pallet/.test(ctx) && input.amount != null) {
    notes.push("Bulk/case pricing context detected — verify pack size");
    return {
      rawObservedPrice: roundMoney(toNumber(input.amount)),
      normalizedUsablePrice: roundMoney(toNumber(input.amount)),
      priceType: "BULK_PRICE",
      vatTreatment,
      usableForAutonomousPricing: true,
      normalizationNotes: notes,
      riskFlags: ["BULK_PRICE"],
    };
  }

  if (input.amount == null || !Number.isFinite(input.amount)) {
    return {
      rawObservedPrice: null,
      normalizedUsablePrice: null,
      priceType: "UNKNOWN_PRICE_TYPE",
      vatTreatment,
      usableForAutonomousPricing: false,
      normalizationNotes: [...notes, "No numeric price found"],
      riskFlags: ["PRICE_NOT_FOUND"],
    };
  }

  const price = roundMoney(toNumber(input.amount));
  return {
    rawObservedPrice: price,
    normalizedUsablePrice: price,
    priceType: "NORMAL_PRICE",
    vatTreatment,
    usableForAutonomousPricing: true,
    normalizationNotes: notes,
    riskFlags,
  };
}

/** Parse first ZAR-like amount from text. */
export function parseZarAmount(text: string): number | null {
  const m = text.replace(/\u00a0/g, " ").match(
    /(?:R\s*|ZAR\s*)(\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?|\d+(?:\.\d{2})?)/i,
  );
  if (!m) return null;
  const n = Number(m[1].replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}
