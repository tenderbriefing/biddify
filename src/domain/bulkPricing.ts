/**
 * Bulk pricing tiers — never fabricate volume discounts.
 */

import { roundMoney, toNumber } from "./money";

export type BulkTier = {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
  evidence: string;
};

export function selectBulkTierPrice(
  packsRequired: number,
  tiers: BulkTier[],
): { price: number | null; tier: BulkTier | null; reason: string } {
  if (tiers.length === 0) {
    return { price: null, tier: null, reason: "No bulk tiers" };
  }
  const applicable = tiers
    .filter(
      (t) =>
        packsRequired >= t.minQty &&
        (t.maxQty == null || packsRequired <= t.maxQty),
    )
    .sort((a, b) => b.minQty - a.minQty);

  if (applicable.length === 0) {
    return {
      price: null,
      tier: null,
      reason: `No tier covers packsRequired=${packsRequired}`,
    };
  }
  const tier = applicable[0];
  return {
    price: roundMoney(toNumber(tier.unitPrice)),
    tier,
    reason: `Applied tier ${tier.minQty}${tier.maxQty != null ? `–${tier.maxQty}` : "+"} @ R${tier.unitPrice} (${tier.evidence})`,
  };
}
