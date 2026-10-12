/**
 * Pack-size normalization for live procurement pricing.
 */

import { roundMoney, toNumber } from "./money";
import { requiredPacks } from "./boqNormalization";

export type PackNormalizationInput = {
  tenderQuantity: number;
  supplierPackSize: number | null;
  packPrice: number | null;
  /** When pack unknown, unit price if selling as each. */
  unitPrice: number | null;
};

export type PackNormalizationResult = {
  packsRequired: number | null;
  unitsPurchased: number | null;
  surplusUnits: number | null;
  effectiveCostPerTenderUnit: number | null;
  totalProductCost: number | null;
  flag: "OK" | "PACK_SIZE_AMBIGUITY" | "INVALID_PACK" | "UNIT_PRICE";
  calculation: string;
};

export function normalizePackPurchase(
  input: PackNormalizationInput,
): PackNormalizationResult {
  const qty = toNumber(input.tenderQuantity);

  if (
    input.supplierPackSize != null &&
    input.supplierPackSize > 1 &&
    input.packPrice != null
  ) {
    const packs = requiredPacks(qty, input.supplierPackSize);
    if (packs.flag === "INVALID_PACK") {
      return {
        packsRequired: null,
        unitsPurchased: null,
        surplusUnits: null,
        effectiveCostPerTenderUnit: null,
        totalProductCost: null,
        flag: "INVALID_PACK",
        calculation: "Invalid supplier pack size",
      };
    }
    const total = roundMoney(packs.packs * toNumber(input.packPrice));
    const unitsPurchased = packs.packs * input.supplierPackSize;
    const effective =
      qty > 0 ? roundMoney(total / qty) : null;
    return {
      packsRequired: packs.packs,
      unitsPurchased,
      surplusUnits: packs.remainder,
      effectiveCostPerTenderUnit: effective,
      totalProductCost: total,
      flag: packs.flag === "OK" ? "OK" : "PACK_SIZE_AMBIGUITY",
      calculation: `ceil(${qty}/${input.supplierPackSize})=${packs.packs} packs × R${input.packPrice} = R${total}; effective unit R${effective}`,
    };
  }

  if (input.unitPrice != null) {
    const total = roundMoney(qty * toNumber(input.unitPrice));
    return {
      packsRequired: null,
      unitsPurchased: qty,
      surplusUnits: 0,
      effectiveCostPerTenderUnit: roundMoney(toNumber(input.unitPrice)),
      totalProductCost: total,
      flag: "UNIT_PRICE",
      calculation: `${qty} × R${input.unitPrice} = R${total}`,
    };
  }

  return {
    packsRequired: null,
    unitsPurchased: null,
    surplusUnits: null,
    effectiveCostPerTenderUnit: null,
    totalProductCost: null,
    flag: "PACK_SIZE_AMBIGUITY",
    calculation: "Pack size and unit price both unknown",
  };
}

/** Parse pack-of-N from product text. */
export function parsePackSize(text: string): number | null {
  const m =
    text.match(/\bpack\s+of\s+(\d+)\b/i) ||
    text.match(/\b(\d+)\s*[x×]\s*pack\b/i) ||
    text.match(/\b(\d+)\s*[- ]?pack\b/i) ||
    text.match(/\b(\d+)\s*per\s*pack\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
