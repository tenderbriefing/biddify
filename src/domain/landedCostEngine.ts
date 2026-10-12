/**
 * Landed cost + commercial flags for autonomous pricing.
 */

import { calculateLandedCost } from "./pricing";
import { requiredPacks } from "./boqNormalization";
import { roundMoney, toNumber } from "./money";

export const LANDED_COST_FLAGS = [
  "UNKNOWN_DELIVERY_COST",
  "UNKNOWN_VAT",
  "PACK_SIZE_AMBIGUITY",
  "AVAILABILITY_UNKNOWN",
] as const;

export type LandedCostFlag = (typeof LANDED_COST_FLAGS)[number];

export type LineLandedInput = {
  tenderQuantity: number;
  /** Unit cost for one sellable / tender unit after pack normalization. */
  unitCost: number | null;
  priceKnown: boolean;
  supplierPackSize?: number | null;
  /** Price of one supplier pack (when pack sizing applies). */
  packPrice?: number | null;
  deliveryCost?: number | null;
  deliveryKnown?: boolean;
  logisticsCost?: number | null;
  otherDirectCosts?: number | null;
  vatTreatmentKnown?: boolean;
  availabilityKnown?: boolean;
};

export type LineLandedResult = {
  productCost: number;
  delivery: number;
  logistics: number;
  otherDirectCosts: number;
  landedCost: number;
  packsRequired: number | null;
  flags: LandedCostFlag[];
  unresolved: boolean;
  notes: string[];
};

export function calculateLineLandedCost(
  input: LineLandedInput,
): LineLandedResult {
  const flags: LandedCostFlag[] = [];
  const notes: string[] = [];
  let unresolved = false;

  if (!input.priceKnown || input.unitCost == null) {
    unresolved = true;
    notes.push("No credible unit price — line unresolved");
    return {
      productCost: 0,
      delivery: 0,
      logistics: 0,
      otherDirectCosts: 0,
      landedCost: 0,
      packsRequired: null,
      flags,
      unresolved: true,
      notes,
    };
  }

  let productCost: number;
  let packsRequired: number | null = null;

  if (input.supplierPackSize && input.supplierPackSize > 1 && input.packPrice != null) {
    const packs = requiredPacks(input.tenderQuantity, input.supplierPackSize);
    packsRequired = packs.packs;
    if (packs.flag === "PACK_SIZE_AMBIGUITY") {
      flags.push("PACK_SIZE_AMBIGUITY");
      notes.push(
        `Pack size ${input.supplierPackSize}: need ${packs.packs} packs for qty ${input.tenderQuantity} (overbuy ${packs.remainder})`,
      );
    }
    if (packs.flag === "INVALID_PACK") {
      unresolved = true;
      flags.push("PACK_SIZE_AMBIGUITY");
      notes.push("Invalid pack size");
    }
    productCost = roundMoney(packs.packs * toNumber(input.packPrice));
  } else {
    productCost = roundMoney(
      toNumber(input.tenderQuantity) * toNumber(input.unitCost),
    );
  }

  const deliveryKnown = input.deliveryKnown === true;
  const delivery = deliveryKnown ? roundMoney(toNumber(input.deliveryCost ?? 0)) : 0;
  if (!deliveryKnown) {
    flags.push("UNKNOWN_DELIVERY_COST");
    notes.push("Delivery cost unknown — not treated as free");
  }

  if (input.vatTreatmentKnown === false) {
    flags.push("UNKNOWN_VAT");
  }

  if (input.availabilityKnown === false) {
    flags.push("AVAILABILITY_UNKNOWN");
  }

  const logistics = roundMoney(toNumber(input.logisticsCost ?? 0));
  const otherDirectCosts = roundMoney(toNumber(input.otherDirectCosts ?? 0));

  const landedCost = calculateLandedCost({
    supplierCost: productCost,
    delivery,
    logistics,
    otherDirectCosts,
  });

  return {
    productCost,
    delivery,
    logistics,
    otherDirectCosts,
    landedCost,
    packsRequired,
    flags,
    unresolved,
    notes,
  };
}

export type AggregateLandedInput = {
  productCost: number;
  delivery: number;
  logistics: number;
  otherDirectCosts?: number;
};

export function aggregateLandedCost(input: AggregateLandedInput): number {
  return calculateLandedCost({
    supplierCost: input.productCost,
    delivery: input.delivery,
    logistics: input.logistics,
    otherDirectCosts: input.otherDirectCosts ?? 0,
  });
}
