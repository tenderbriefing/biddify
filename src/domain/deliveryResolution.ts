/**
 * Delivery resolution V2 — research before blocking on material unknown.
 */

import {
  extractDeliveryFromText,
  type DeliveryEvidence,
} from "./deliveryEvidence";
import {
  classifyDeliveryV2,
  type DeliveryClassV2,
  type DeliveryMaterialityV2,
} from "./deliveryMaterialityV2";

export const DELIVERY_RESOLUTION_CLASSES = [
  "DELIVERY_ZERO_CONFIRMED",
  "DELIVERY_FIXED_CONFIRMED",
  "DELIVERY_ESTIMATED",
  "DELIVERY_UNKNOWN_IMMATERIAL",
  "DELIVERY_UNKNOWN_MATERIAL",
] as const;

export type DeliveryResolutionClass =
  (typeof DELIVERY_RESOLUTION_CLASSES)[number];

export type DeliveryResolution = {
  class: DeliveryResolutionClass;
  amountForLanded: number;
  allowance: number;
  known: boolean;
  blocksAutoQuoted: boolean;
  evidence: DeliveryEvidence;
  materiality: DeliveryMaterialityV2;
  geography: string | null;
  researchAttempted: boolean;
  notes: string[];
};

export function resolveDelivery(input: {
  primary: DeliveryEvidence;
  additionalTexts?: string[];
  productCost: number;
  expectedGrossProfit?: number | null;
  researchAttempted?: boolean;
}): DeliveryResolution {
  let best = input.primary;
  const notes = [...(input.primary.notes ?? [])];

  for (const text of input.additionalTexts ?? []) {
    const extracted = extractDeliveryFromText(text);
    if (
      extracted.known ||
      extracted.type === "DELIVERY_THRESHOLD" ||
      extracted.type === "FIXED_DELIVERY" ||
      extracted.type === "FREE_DELIVERY"
    ) {
      // Prefer known / more specific
      if (
        !best.known ||
        (extracted.known && extracted.amount != null) ||
        extracted.type === "FREE_DELIVERY"
      ) {
        best = extracted;
        notes.push(`Improved via delivery research: ${extracted.type}`);
      }
    }
  }

  const materiality = classifyDeliveryV2({
    delivery: best,
    productCost: input.productCost,
    expectedGrossProfit: input.expectedGrossProfit,
  });

  const mapped = mapClass(materiality.class, best);
  return {
    class: mapped,
    amountForLanded: materiality.amountForLanded,
    allowance: materiality.allowance,
    known: materiality.known,
    blocksAutoQuoted: materiality.blocksAutoQuoted,
    evidence: best,
    materiality,
    geography: best.destinationAssumption,
    researchAttempted: Boolean(input.researchAttempted),
    notes,
  };
}

function mapClass(
  v2: DeliveryClassV2,
  evidence: DeliveryEvidence,
): DeliveryResolutionClass {
  if (v2 === "KNOWN_FREE") return "DELIVERY_ZERO_CONFIRMED";
  if (v2 === "KNOWN_FIXED") return "DELIVERY_FIXED_CONFIRMED";
  if (v2 === "THRESHOLD_SATISFIED") return "DELIVERY_ZERO_CONFIRMED";
  if (v2 === "UNKNOWN_IMMATERIAL") return "DELIVERY_UNKNOWN_IMMATERIAL";
  if (v2 === "UNKNOWN_MATERIAL") return "DELIVERY_UNKNOWN_MATERIAL";
  if (
    evidence.type === "CALCULATED_DELIVERY" ||
    evidence.type === "DELIVERY_THRESHOLD"
  ) {
    return "DELIVERY_ESTIMATED";
  }
  if (v2 === "THRESHOLD_NOT_SATISFIED" || v2 === "COLLECTION_AVAILABLE") {
    return "DELIVERY_UNKNOWN_MATERIAL";
  }
  return "DELIVERY_UNKNOWN_MATERIAL";
}
