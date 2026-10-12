/**
 * Extract supplier pack / selling-unit semantics from listing text.
 * Ambiguous listings → PACK_SIZE_UNKNOWN — not firm evidence.
 */

import { normalizeUnit, type NormalizedUnit } from "./unitOfMeasure";
import { priceBasisFromSellingUnit, type PriceBasis } from "./priceBasis";

export type PackExtraction = {
  supplierSellingUnit: NormalizedUnit;
  packSize: number | null;
  /** What one pack contains, e.g. 4 EACH. */
  packContentsUnit: NormalizedUnit;
  priceUnit: PriceBasis;
  packExtractionConfidence: number;
  packEvidence: string;
  flags: string[];
};

const PACK_OF =
  /\b(?:pack(?:s)?\s+of|pk\s+of|×|x)\s*(\d+)\b|\b(\d+)\s*[x×]\s*(?:pack|pk)?\b|\b(\d+)\s*(?:-|\s)?pack\b|\b(\d+)\s*per\s*pack\b/i;

export function extractPackSemantics(input: {
  productName: string;
  description?: string | null;
  tenderUnit?: string | null;
  explicitPackSize?: number | null;
}): PackExtraction {
  const text = [input.productName, input.description ?? ""].join(" ");
  const flags: string[] = [];
  const tenderUnit = normalizeUnit(input.tenderUnit);

  if (input.explicitPackSize != null && input.explicitPackSize > 1) {
    return {
      supplierSellingUnit: "PACK",
      packSize: input.explicitPackSize,
      packContentsUnit: tenderUnit === "UNKNOWN" ? "EACH" : tenderUnit,
      priceUnit: "PER_PACK",
      packExtractionConfidence: 0.85,
      packEvidence: `Explicit pack size ${input.explicitPackSize}`,
      flags: [],
    };
  }

  const m = text.match(PACK_OF);
  const packSize = m
    ? Number(m[1] || m[2] || m[3] || m[4])
    : null;

  if (packSize && Number.isFinite(packSize) && packSize > 1) {
    return {
      supplierSellingUnit: "PACK",
      packSize,
      packContentsUnit: "EACH",
      priceUnit: "PER_PACK",
      packExtractionConfidence: 0.8,
      packEvidence: `Parsed pack size ${packSize} from listing: "${m?.[0]}"`,
      flags: [],
    };
  }

  // Roll / bottle / each as selling unit when product is clearly singular
  if (/\broll\b/i.test(text) && !/\b\d+\s*roll/i.test(text)) {
    return {
      supplierSellingUnit: "ROLL",
      packSize: 1,
      packContentsUnit: "ROLL",
      priceUnit: "PER_ROLL",
      packExtractionConfidence: 0.7,
      packEvidence: "Listing indicates single ROLL selling unit",
      flags: [],
    };
  }

  if (/\bbottle\b/i.test(text) && !packSize) {
    return {
      supplierSellingUnit: "BOTTLE",
      packSize: 1,
      packContentsUnit: "BOTTLE",
      priceUnit: "PER_BOTTLE",
      packExtractionConfidence: 0.65,
      packEvidence: "Listing indicates BOTTLE selling unit",
      flags: [],
    };
  }

  // "N Pack" multi-buy of bottles etc.
  const multiBottle = text.match(/\b(\d+)\s*pack\b/i);
  if (multiBottle && /bottle|liquid|ml\b/i.test(text)) {
    const n = Number(multiBottle[1]);
    if (n > 1) {
      return {
        supplierSellingUnit: "PACK",
        packSize: n,
        packContentsUnit: "BOTTLE",
        priceUnit: "PER_PACK",
        packExtractionConfidence: 0.75,
        packEvidence: `Multi-bottle pack of ${n}`,
        flags: [],
      };
    }
  }

  // Ambiguous battery / goods listing without pack size
  if (/batter(?:y|ies)|duracell|energizer/i.test(text) && !packSize) {
    flags.push("PACK_SIZE_UNKNOWN");
    return {
      supplierSellingUnit: "UNKNOWN",
      packSize: null,
      packContentsUnit: "EACH",
      priceUnit: "UNKNOWN",
      packExtractionConfidence: 0.2,
      packEvidence: "Battery listing without explicit pack size — not firm",
      flags,
    };
  }

  // Default: treat as EACH when tender is EACH and no pack language
  if (tenderUnit === "EACH" || tenderUnit === "UNIT" || tenderUnit === "UNKNOWN") {
    if (!/\bpack|box|case|carton\b/i.test(text)) {
      return {
        supplierSellingUnit: "EACH",
        packSize: 1,
        packContentsUnit: "EACH",
        priceUnit: priceBasisFromSellingUnit("EACH"),
        packExtractionConfidence: 0.55,
        packEvidence: "No pack language — assumed PER_EACH (moderate confidence)",
        flags: ["ASSUMED_EACH"],
      };
    }
  }

  flags.push("PACK_SIZE_UNKNOWN");
  return {
    supplierSellingUnit: "UNKNOWN",
    packSize: null,
    packContentsUnit: tenderUnit === "UNKNOWN" ? "EACH" : tenderUnit,
    priceUnit: "UNKNOWN",
    packExtractionConfidence: 0.15,
    packEvidence: "Ambiguous listing — pack size unknown",
    flags,
  };
}

export function isFirmPackEvidence(extraction: PackExtraction): boolean {
  return (
    extraction.packExtractionConfidence >= 0.55 &&
    extraction.priceUnit !== "UNKNOWN" &&
    !extraction.flags.includes("PACK_SIZE_UNKNOWN") &&
    extraction.packSize != null &&
    extraction.packSize > 0
  );
}
