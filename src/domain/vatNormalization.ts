/**
 * Normalize supplier prices onto a consistent economic basis before comparison.
 * Bidder VAT remains separate.
 */

import { roundMoney, toNumber } from "./money";

export type SupplierVatBasis = "VAT_INCLUSIVE" | "VAT_EXCLUSIVE" | "NON_VAT" | "UNKNOWN";

export type NormalizedProcurementPrice = {
  rawPrice: number;
  basis: SupplierVatBasis;
  /** Price used for like-for-like comparison (ex-VAT when determinable). */
  comparisonExVat: number | null;
  /** Acquisition cost for a non-VAT-registered bidder (absorbs irrecoverable VAT). */
  acquisitionForNonVatBidder: number | null;
  usable: boolean;
  notes: string[];
};

export function normalizeSupplierPriceForComparison(input: {
  price: number;
  vatBasis: SupplierVatBasis;
  vatRatePercent?: number;
}): NormalizedProcurementPrice {
  const price = roundMoney(toNumber(input.price));
  const rate = toNumber(input.vatRatePercent ?? 15);
  const notes: string[] = [];

  if (input.vatBasis === "UNKNOWN") {
    notes.push("VAT UNKNOWN — comparison uses raw price with caution");
    return {
      rawPrice: price,
      basis: "UNKNOWN",
      comparisonExVat: null,
      acquisitionForNonVatBidder: price,
      usable: false,
      notes,
    };
  }

  if (input.vatBasis === "VAT_INCLUSIVE") {
    const ex = roundMoney(price / (1 + rate / 100));
    notes.push(`VAT-inclusive → ex-VAT comparison R${ex}`);
    return {
      rawPrice: price,
      basis: "VAT_INCLUSIVE",
      comparisonExVat: ex,
      acquisitionForNonVatBidder: price,
      usable: true,
      notes,
    };
  }

  if (input.vatBasis === "VAT_EXCLUSIVE") {
    notes.push("VAT-exclusive — comparison uses stated price");
    return {
      rawPrice: price,
      basis: "VAT_EXCLUSIVE",
      comparisonExVat: price,
      acquisitionForNonVatBidder: roundMoney(price * (1 + rate / 100)),
      usable: true,
      notes,
    };
  }

  // NON_VAT
  return {
    rawPrice: price,
    basis: "NON_VAT",
    comparisonExVat: price,
    acquisitionForNonVatBidder: price,
    usable: true,
    notes: ["Non-VAT supply"],
  };
}
