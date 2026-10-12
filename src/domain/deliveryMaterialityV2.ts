/**
 * Delivery economics V2 — materiality relative to product cost / GP / quote value.
 */

import { roundMoney, toNumber } from "./money";
import type { DeliveryEvidence } from "./deliveryEvidence";

export const DELIVERY_CLASS_V2 = [
  "KNOWN_FREE",
  "KNOWN_FIXED",
  "THRESHOLD_SATISFIED",
  "THRESHOLD_NOT_SATISFIED",
  "COLLECTION_AVAILABLE",
  "UNKNOWN_MATERIAL",
  "UNKNOWN_IMMATERIAL",
] as const;

export type DeliveryClassV2 = (typeof DELIVERY_CLASS_V2)[number];

export const DELIVERY_MATERIALITY_POLICY = {
  /** Unknown delivery as fraction of product cost considered material. */
  materialFractionOfProduct: 0.05,
  /** Absolute ZAR floor for material unknown delivery. */
  materialFloorZar: 400,
  /** Cap for immaterial conservative allowance. */
  immaterialAllowanceCapZar: 250,
  immaterialAllowanceFraction: 0.02,
} as const;

export type DeliveryMaterialityV2 = {
  class: DeliveryClassV2;
  amountForLanded: number;
  allowance: number;
  known: boolean;
  blocksAutoQuoted: boolean;
  reason: string;
};

export function classifyDeliveryV2(input: {
  delivery: DeliveryEvidence;
  productCost: number;
  expectedGrossProfit?: number | null;
  quotationValue?: number | null;
}): DeliveryMaterialityV2 {
  const d = input.delivery;
  const productCost = toNumber(input.productCost);

  if (d.type === "FREE_DELIVERY" && d.known && d.amount === 0) {
    return {
      class: "KNOWN_FREE",
      amountForLanded: 0,
      allowance: 0,
      known: true,
      blocksAutoQuoted: false,
      reason: "Known free delivery",
    };
  }

  if (d.type === "FIXED_DELIVERY" && d.known && d.amount != null) {
    return {
      class: "KNOWN_FIXED",
      amountForLanded: roundMoney(d.amount),
      allowance: 0,
      known: true,
      blocksAutoQuoted: false,
      reason: `Known fixed delivery R${d.amount}`,
    };
  }

  if (d.type === "DELIVERY_THRESHOLD") {
    if (
      d.threshold != null &&
      productCost >= d.threshold
    ) {
      return {
        class: "THRESHOLD_SATISFIED",
        amountForLanded: 0,
        allowance: 0,
        known: true,
        blocksAutoQuoted: false,
        reason: `Free-delivery threshold R${d.threshold} satisfied by product cost`,
      };
    }
    return {
      class: "THRESHOLD_NOT_SATISFIED",
      amountForLanded: 0,
      allowance: 0,
      known: false,
      blocksAutoQuoted: true,
      reason: "Delivery threshold not satisfied — cost unknown",
    };
  }

  if (d.type === "COLLECTION_ONLY") {
    return {
      class: "COLLECTION_AVAILABLE",
      amountForLanded: 0,
      allowance: 0,
      known: false,
      blocksAutoQuoted: true,
      reason: "Collection only — delivery to tender destination unknown",
    };
  }

  // Unknown
  const policy = DELIVERY_MATERIALITY_POLICY;
  const impact = Math.max(
    policy.materialFloorZar,
    productCost * policy.materialFractionOfProduct,
  );
  const relativeToGp =
    input.expectedGrossProfit != null && input.expectedGrossProfit > 0
      ? impact / input.expectedGrossProfit
      : null;

  const material =
    impact >= policy.materialFloorZar &&
    (productCost * policy.materialFractionOfProduct >= policy.materialFloorZar ||
      (relativeToGp != null && relativeToGp >= 0.25));

  if (material) {
    return {
      class: "UNKNOWN_MATERIAL",
      amountForLanded: 0,
      allowance: 0,
      known: false,
      blocksAutoQuoted: true,
      reason: `Unknown delivery material vs product cost R${productCost} (impact ≥ R${roundMoney(impact)})`,
    };
  }

  const allowance = Math.min(
    policy.immaterialAllowanceCapZar,
    roundMoney(productCost * policy.immaterialAllowanceFraction),
  );
  return {
    class: "UNKNOWN_IMMATERIAL",
    amountForLanded: 0,
    allowance,
    known: false,
    blocksAutoQuoted: false,
    reason: `Unknown delivery immaterial — explicit conservative allowance R${allowance}`,
  };
}
