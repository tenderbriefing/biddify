/**
 * Explicit price basis — UNKNOWN basis cannot be firm autonomous evidence.
 */

export const PRICE_BASES = [
  "PER_EACH",
  "PER_PACK",
  "PER_BOX",
  "PER_CASE",
  "PER_CARTON",
  "PER_ROLL",
  "PER_BOTTLE",
  "PER_KG",
  "PER_LITRE",
  "PER_SET",
  "UNKNOWN",
] as const;

export type PriceBasis = (typeof PRICE_BASES)[number];

export function priceBasisFromSellingUnit(
  sellingUnit: string,
): PriceBasis {
  switch (sellingUnit) {
    case "EACH":
    case "UNIT":
      return "PER_EACH";
    case "PACK":
      return "PER_PACK";
    case "BOX":
      return "PER_BOX";
    case "CASE":
      return "PER_CASE";
    case "CARTON":
      return "PER_CARTON";
    case "ROLL":
      return "PER_ROLL";
    case "BOTTLE":
      return "PER_BOTTLE";
    case "KILOGRAM":
      return "PER_KG";
    case "LITRE":
      return "PER_LITRE";
    case "SET":
      return "PER_SET";
    default:
      return "UNKNOWN";
  }
}

export function isFirmPriceBasis(basis: PriceBasis): boolean {
  return basis !== "UNKNOWN";
}
