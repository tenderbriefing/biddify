/**
 * Full procurement candidate record — never compare raw displayed prices
 * when price bases differ.
 */

import type { SpecEquivalenceResult } from "./specificationEquivalence";
import type { QuantityReconciliation } from "./quantityReconciliation";
import type { StockAssessment } from "./stockAssessment";
import type { DeliveryMaterialityV2 } from "./deliveryMaterialityV2";
import type { NormalizedProcurementPrice } from "./vatNormalization";
import { roundMoney } from "./money";

export type ProcurementCandidate = {
  id: string;
  supplier: string;
  sourceUrl: string | null;
  sourceType: string;
  productTitle: string;
  brand: string | null;
  sku: string | null;
  tenderSpecification: string;
  extractedSupplierSpecification: string | null;
  unitOfMeasure: string;
  supplierSellingUnit: string;
  packSize: number | null;
  priceBasis: string;
  displayedPrice: number | null;
  vatStatus: string;
  vatNormalized: NormalizedProcurementPrice | null;
  stock: StockAssessment;
  delivery: DeliveryMaterialityV2 | null;
  deliveryCharge: number | null;
  deliveryGeography: string | null;
  timestamp: string;
  evidenceQuality: number;
  specification: SpecEquivalenceResult;
  quantityReconciliation: QuantityReconciliation | null;
  packsRequired: number | null;
  unitsPurchased: number | null;
  surplusUnits: number | null;
  procurementSubtotal: number | null;
  deliveryAllocation: number;
  otherKnownProcurementCosts: number;
  landedProcurementCost: number | null;
  effectiveTenderUnitCost: number | null;
  commercialIntegrityFirm: boolean;
  integrityFlags: string[];
};

export function computeCandidateLandedCost(input: {
  productCost: number | null;
  deliveryCost: number | null;
  otherKnownProcurementCosts?: number;
  tenderQuantity: number;
}): {
  landedProcurementCost: number | null;
  effectiveTenderUnitCost: number | null;
} {
  if (input.productCost == null || !Number.isFinite(input.productCost)) {
    return { landedProcurementCost: null, effectiveTenderUnitCost: null };
  }
  const delivery = roundMoney(input.deliveryCost ?? 0);
  const other = roundMoney(input.otherKnownProcurementCosts ?? 0);
  const landed = roundMoney(input.productCost + delivery + other);
  const effective =
    input.tenderQuantity > 0
      ? roundMoney(landed / input.tenderQuantity)
      : null;
  return { landedProcurementCost: landed, effectiveTenderUnitCost: effective };
}
