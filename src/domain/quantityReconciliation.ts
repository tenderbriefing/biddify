/**
 * Explicit quantity reconciliation: tender requirement × supplier selling form.
 */

import { roundMoney, toNumber } from "./money";
import { normalizeUnit, type NormalizedUnit } from "./unitOfMeasure";
import { type PriceBasis, isFirmPriceBasis } from "./priceBasis";
import {
  extractPackSemantics,
  isFirmPackEvidence,
  type PackExtraction,
} from "./packExtraction";

export type QuantityReconciliationInput = {
  tenderQuantity: number;
  tenderUnit: string;
  /** Spec dimensions only — never confuse with tender qty. */
  productAttributes?: {
    volumeMl?: number | null;
    massG?: number | null;
    widthMm?: number | null;
    lengthM?: number | null;
  };
  productName: string;
  productDescription?: string | null;
  observedSupplierPrice: number | null;
  explicitPackSize?: number | null;
};

export type QuantityReconciliation = {
  tenderQuantity: number;
  tenderUnit: NormalizedUnit;
  requiredProductAttributes: QuantityReconciliationInput["productAttributes"];

  supplierSellingUnit: NormalizedUnit;
  supplierPackSize: number | null;
  supplierPriceBasis: PriceBasis;
  packExtraction: PackExtraction;

  conversionFactor: number;
  packsRequired: number | null;
  unitsPurchased: number | null;
  surplusUnits: number | null;

  observedSupplierPrice: number | null;
  effectiveTenderUnitCost: number | null;
  procurementCost: number | null;

  confidence: number;
  flags: string[];
  reasoning: string;
  humanReadable: string;
  firm: boolean;
};

export function reconcileQuantity(
  input: QuantityReconciliationInput,
): QuantityReconciliation {
  const tenderUnit = normalizeUnit(input.tenderUnit);
  const tenderQuantity = toNumber(input.tenderQuantity);
  const pack = extractPackSemantics({
    productName: input.productName,
    description: input.productDescription,
    tenderUnit: input.tenderUnit,
    explicitPackSize: input.explicitPackSize,
  });

  const flags = [...pack.flags];
  const price = input.observedSupplierPrice;

  if (price == null || !Number.isFinite(price) || price <= 0) {
    return baseFail(
      input,
      tenderUnit,
      pack,
      flags,
      "No observed supplier price",
    );
  }

  if (!isFirmPriceBasis(pack.priceUnit) || !isFirmPackEvidence(pack)) {
    flags.push("PACK_SIZE_UNKNOWN");
    return {
      ...emptyNums(input, tenderUnit, pack, price),
      confidence: Math.min(pack.packExtractionConfidence, 0.35),
      flags,
      reasoning:
        "Price basis or pack size not firm — cannot use as autonomous procurement evidence",
      humanReadable: buildHumanReadable({
        tenderQuantity,
        tenderUnit,
        productName: input.productName,
        pack,
        price,
        packsRequired: null,
        procurementCost: null,
        effective: null,
        note: "BLOCKED — pack/price basis unknown",
      }),
      firm: false,
    };
  }

  const packSize = pack.packSize!;
  const conversionFactor = packSize; // pack contains N tender units when contents are EACH/BOTTLE/etc.

  // Simple EACH × EACH
  if (
    (pack.supplierSellingUnit === "EACH" ||
      pack.supplierSellingUnit === "UNIT" ||
      pack.supplierSellingUnit === "ROLL" ||
      pack.supplierSellingUnit === "BOTTLE") &&
    packSize === 1 &&
    (pack.priceUnit === "PER_EACH" ||
      pack.priceUnit === "PER_ROLL" ||
      pack.priceUnit === "PER_BOTTLE")
  ) {
    const procurementCost = roundMoney(tenderQuantity * price);
    const human = buildHumanReadable({
      tenderQuantity,
      tenderUnit,
      productName: input.productName,
      pack,
      price,
      packsRequired: tenderQuantity,
      procurementCost,
      effective: price,
      note: null,
    });
    return {
      tenderQuantity,
      tenderUnit,
      requiredProductAttributes: input.productAttributes,
      supplierSellingUnit: pack.supplierSellingUnit,
      supplierPackSize: 1,
      supplierPriceBasis: pack.priceUnit,
      packExtraction: pack,
      conversionFactor: 1,
      packsRequired: tenderQuantity,
      unitsPurchased: tenderQuantity,
      surplusUnits: 0,
      observedSupplierPrice: price,
      effectiveTenderUnitCost: roundMoney(price),
      procurementCost,
      confidence: pack.packExtractionConfidence,
      flags,
      reasoning: `${tenderQuantity} × ${pack.supplierSellingUnit} @ R${price} = R${procurementCost}`,
      humanReadable: human,
      firm: true,
    };
  }

  // Pack / multi-buy
  const packsRequired = Math.ceil(tenderQuantity / packSize);
  const unitsPurchased = packsRequired * packSize;
  const surplusUnits = unitsPurchased - tenderQuantity;
  const procurementCost = roundMoney(packsRequired * price);
  const effective =
    tenderQuantity > 0 ? roundMoney(procurementCost / tenderQuantity) : null;

  if (surplusUnits > 0) flags.push("SURPLUS_UNITS");
  if (packsRequired > tenderQuantity * 2) flags.push("PACK_SIZE_ANOMALY");

  const reasoning = `ceil(${tenderQuantity}/${packSize})=${packsRequired} packs × R${price} = R${procurementCost}; purchase ${unitsPurchased}, surplus ${surplusUnits}`;

  return {
    tenderQuantity,
    tenderUnit,
    requiredProductAttributes: input.productAttributes,
    supplierSellingUnit: pack.supplierSellingUnit,
    supplierPackSize: packSize,
    supplierPriceBasis: pack.priceUnit,
    packExtraction: pack,
    conversionFactor,
    packsRequired,
    unitsPurchased,
    surplusUnits,
    observedSupplierPrice: price,
    effectiveTenderUnitCost: effective,
    procurementCost,
    confidence: pack.packExtractionConfidence,
    flags,
    reasoning,
    humanReadable: buildHumanReadable({
      tenderQuantity,
      tenderUnit,
      productName: input.productName,
      pack,
      price,
      packsRequired,
      procurementCost,
      effective,
      note: surplusUnits > 0 ? `Surplus ${surplusUnits} units purchased` : null,
    }),
    firm: true,
  };
}

function emptyNums(
  input: QuantityReconciliationInput,
  tenderUnit: NormalizedUnit,
  pack: PackExtraction,
  price: number | null,
): Omit<
  QuantityReconciliation,
  "confidence" | "flags" | "reasoning" | "humanReadable" | "firm"
> {
  return {
    tenderQuantity: input.tenderQuantity,
    tenderUnit,
    requiredProductAttributes: input.productAttributes,
    supplierSellingUnit: pack.supplierSellingUnit,
    supplierPackSize: pack.packSize,
    supplierPriceBasis: pack.priceUnit,
    packExtraction: pack,
    conversionFactor: pack.packSize ?? 1,
    packsRequired: null,
    unitsPurchased: null,
    surplusUnits: null,
    observedSupplierPrice: price,
    effectiveTenderUnitCost: null,
    procurementCost: null,
  };
}

function baseFail(
  input: QuantityReconciliationInput,
  tenderUnit: NormalizedUnit,
  pack: PackExtraction,
  flags: string[],
  reason: string,
): QuantityReconciliation {
  return {
    ...emptyNums(input, tenderUnit, pack, input.observedSupplierPrice),
    confidence: 0,
    flags: [...flags, "NO_PRICE"],
    reasoning: reason,
    humanReadable: reason,
    firm: false,
  };
}

function buildHumanReadable(opts: {
  tenderQuantity: number;
  tenderUnit: NormalizedUnit;
  productName: string;
  pack: PackExtraction;
  price: number | null;
  packsRequired: number | null;
  procurementCost: number | null;
  effective: number | null;
  note: string | null;
}): string {
  const lines = [
    `Tender requires: ${opts.tenderQuantity} ${opts.tenderUnit}`,
    `Selected supplier listing: ${opts.productName}`,
    `Observed price: ${opts.price != null ? `R${opts.price}` : "—"} / ${opts.pack.priceUnit}`,
  ];
  if (opts.pack.packSize && opts.pack.packSize > 1) {
    lines.push(`Pack size: ${opts.pack.packSize} ${opts.pack.packContentsUnit}`);
  }
  if (opts.packsRequired != null && opts.procurementCost != null) {
    lines.push(
      `Calculation: ${opts.packsRequired} × R${opts.price} = R${opts.procurementCost}`,
    );
  }
  if (opts.effective != null) {
    lines.push(`Effective tender-unit cost: R${opts.effective}`);
  }
  if (opts.note) lines.push(opts.note);
  return lines.join("\n");
}

/** Like-for-like effective unit cost for cross-source comparison. */
export function effectiveUnitCostFromReconciliation(
  r: QuantityReconciliation,
): number | null {
  return r.effectiveTenderUnitCost;
}
