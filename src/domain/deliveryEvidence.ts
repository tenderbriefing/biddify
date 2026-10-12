/**
 * Delivery evidence separate from product price.
 * UNKNOWN_DELIVERY is never R0.
 */

import { roundMoney, toNumber } from "./money";
import { RESEARCH_POLICY } from "./researchPolicy";

export const DELIVERY_TYPES = [
  "FREE_DELIVERY",
  "FIXED_DELIVERY",
  "CALCULATED_DELIVERY",
  "COLLECTION_ONLY",
  "DELIVERY_THRESHOLD",
  "UNKNOWN_DELIVERY",
] as const;

export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export type DeliveryEvidence = {
  type: DeliveryType;
  amount: number | null;
  threshold: number | null;
  destinationAssumption: string | null;
  source: string | null;
  known: boolean;
  notes: string[];
};

export function extractDeliveryFromText(
  text: string,
  sourceUrl?: string | null,
): DeliveryEvidence {
  const t = text.toLowerCase();
  const notes: string[] = [];

  if (/collection\s*only|collect\s*from\s*store|in.?store\s*collection/.test(t)) {
    return {
      type: "COLLECTION_ONLY",
      amount: null,
      threshold: null,
      destinationAssumption: null,
      source: sourceUrl ?? null,
      known: false,
      notes: ["Collection only — delivery cost unknown for tender destination"],
    };
  }

  if (/free\s*delivery|free\s*shipping|delivery\s*free/.test(t)) {
    const thresholdMatch = t.match(
      /free\s*delivery[^.]{0,40}(?:over|above|orders?\s*(?:of|from)?)\s*r?\s*(\d[\d\s,]*)/i,
    );
    if (thresholdMatch) {
      const threshold = Number(thresholdMatch[1].replace(/[\s,]/g, ""));
      return {
        type: "DELIVERY_THRESHOLD",
        amount: null,
        threshold: Number.isFinite(threshold) ? threshold : null,
        destinationAssumption: "South Africa metro (assumed from page)",
        source: sourceUrl ?? null,
        known: false,
        notes: [
          `Free delivery above threshold R${threshold} — confirm order meets threshold`,
        ],
      };
    }
    return {
      type: "FREE_DELIVERY",
      amount: 0,
      threshold: null,
      destinationAssumption: "South Africa metro (assumed from page)",
      source: sourceUrl ?? null,
      known: true,
      notes: ["Page states free delivery"],
    };
  }

  const fixed = t.match(
    /delivery[^.]{0,30}(?:fee|cost|charge)?[^.]{0,20}r\s*(\d[\d\s,]*(?:\.\d{2})?)/i,
  );
  if (fixed) {
    const amount = Number(fixed[1].replace(/[\s,]/g, ""));
    return {
      type: "FIXED_DELIVERY",
      amount: Number.isFinite(amount) ? roundMoney(amount) : null,
      threshold: null,
      destinationAssumption: "South Africa metro (assumed from page)",
      source: sourceUrl ?? null,
      known: Number.isFinite(amount),
      notes: ["Fixed delivery amount parsed from page"],
    };
  }

  if (/calculate\s*delivery|shipping\s*calculator|enter\s*(?:your\s*)?address/.test(t)) {
    return {
      type: "CALCULATED_DELIVERY",
      amount: null,
      threshold: null,
      destinationAssumption: null,
      source: sourceUrl ?? null,
      known: false,
      notes: ["Delivery requires address calculator — not auto-resolved"],
    };
  }

  notes.push("No delivery information found on page");
  return {
    type: "UNKNOWN_DELIVERY",
    amount: null,
    threshold: null,
    destinationAssumption: null,
    source: sourceUrl ?? null,
    known: false,
    notes,
  };
}

export type DeliveryMateriality = {
  material: boolean;
  band: "LOW" | "MATERIAL" | "KNOWN";
  reason: string;
};

export function assessDeliveryMateriality(
  productCost: number,
  delivery: DeliveryEvidence,
): DeliveryMateriality {
  if (delivery.known && delivery.amount != null) {
    return {
      material: false,
      band: "KNOWN",
      reason: `Known delivery R${delivery.amount}`,
    };
  }
  const policy = RESEARCH_POLICY.delivery;
  const cost = toNumber(productCost);
  const relativeImpact = cost * policy.materialityFraction;
  // Typical SA metro delivery uncertainty ~ allowance cap; compare to line economics
  const uncertainAmount = Math.max(
    policy.lowMaterialityAllowanceCapZar,
    relativeImpact,
  );
  if (
    uncertainAmount >= policy.materialityFloorZar &&
    relativeImpact >= policy.materialityFloorZar
  ) {
    return {
      material: true,
      band: "MATERIAL",
      reason: `Unknown delivery could exceed R${roundMoney(uncertainAmount)} on product cost R${cost}`,
    };
  }
  return {
    material: false,
    band: "LOW",
    reason: `Unknown delivery low materiality vs product cost R${cost}`,
  };
}

/**
 * Low-materiality unknown delivery may take an explicit risk allowance.
 * Material uncertainty must escalate — never bury in markup.
 */
export function deliveryRiskAllowance(
  productCost: number,
  delivery: DeliveryEvidence,
): { amount: number; apply: boolean; reason: string } {
  if (delivery.known) {
    return { amount: 0, apply: false, reason: "Delivery known — no allowance" };
  }
  const materiality = assessDeliveryMateriality(productCost, delivery);
  if (materiality.band === "MATERIAL") {
    return {
      amount: 0,
      apply: false,
      reason:
        "MATERIAL unknown delivery — REVIEW_REQUIRED; do not compensate via markup or silent allowance",
    };
  }
  const policy = RESEARCH_POLICY.delivery;
  const amount = Math.min(
    policy.lowMaterialityAllowanceCapZar,
    roundMoney(toNumber(productCost) * policy.lowMaterialityAllowanceFraction),
  );
  return {
    amount,
    apply: amount > 0,
    reason: `LOW materiality delivery allowance R${amount} (explicit, separate from markup)`,
  };
}
