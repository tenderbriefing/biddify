/**
 * Normalized unit-of-measure taxonomy for commercial integrity.
 * Do not rely on string equality — use aliases.
 */

export const NORMALIZED_UNITS = [
  "EACH",
  "PACK",
  "BOX",
  "CASE",
  "CARTON",
  "ROLL",
  "BOTTLE",
  "TUB",
  "BAG",
  "PAIR",
  "SET",
  "REAM",
  "LITRE",
  "MILLILITRE",
  "KILOGRAM",
  "GRAM",
  "METRE",
  "MILLIMETRE",
  "SHEET",
  "UNIT",
  "UNKNOWN",
] as const;

export type NormalizedUnit = (typeof NORMALIZED_UNITS)[number];

const ALIASES: Record<string, NormalizedUnit> = {
  ea: "EACH",
  each: "EACH",
  pcs: "EACH",
  pc: "EACH",
  piece: "EACH",
  pieces: "EACH",
  unit: "UNIT",
  units: "UNIT",
  pk: "PACK",
  pack: "PACK",
  packs: "PACK",
  pkt: "PACK",
  packet: "PACK",
  box: "BOX",
  boxes: "BOX",
  case: "CASE",
  cases: "CASE",
  ctn: "CARTON",
  carton: "CARTON",
  cartons: "CARTON",
  roll: "ROLL",
  rolls: "ROLL",
  bottle: "BOTTLE",
  bottles: "BOTTLE",
  tub: "TUB",
  bag: "BAG",
  bags: "BAG",
  pair: "PAIR",
  pairs: "PAIR",
  set: "SET",
  sets: "SET",
  ream: "REAM",
  reams: "REAM",
  l: "LITRE",
  lt: "LITRE",
  ltr: "LITRE",
  litre: "LITRE",
  liter: "LITRE",
  litres: "LITRE",
  ml: "MILLILITRE",
  millilitre: "MILLILITRE",
  milliliter: "MILLILITRE",
  kg: "KILOGRAM",
  kilogram: "KILOGRAM",
  kilograms: "KILOGRAM",
  g: "GRAM",
  gram: "GRAM",
  grams: "GRAM",
  m: "METRE",
  meter: "METRE",
  metre: "METRE",
  meters: "METRE",
  metres: "METRE",
  mm: "MILLIMETRE",
  millimetre: "MILLIMETRE",
  millimeter: "MILLIMETRE",
  sheet: "SHEET",
  sheets: "SHEET",
};

export function normalizeUnit(raw: string | null | undefined): NormalizedUnit {
  if (!raw?.trim()) return "UNKNOWN";
  const key = raw.trim().toLowerCase().replace(/\./g, "");
  return ALIASES[key] ?? "UNKNOWN";
}

/** True when unit is a countable sellable object (not a measure of mass/volume/length alone). */
export function isCountableUnit(unit: NormalizedUnit): boolean {
  return ![
    "LITRE",
    "MILLILITRE",
    "KILOGRAM",
    "GRAM",
    "METRE",
    "MILLIMETRE",
    "UNKNOWN",
  ].includes(unit);
}

/**
 * Conversion factor between measure units of the same dimension.
 * Returns null if conversion is not defined / not needed.
 */
export function measureConversionFactor(
  from: NormalizedUnit,
  to: NormalizedUnit,
): number | null {
  if (from === to) return 1;
  const mass: Partial<Record<NormalizedUnit, number>> = {
    GRAM: 1,
    KILOGRAM: 1000,
  };
  const vol: Partial<Record<NormalizedUnit, number>> = {
    MILLILITRE: 1,
    LITRE: 1000,
  };
  const len: Partial<Record<NormalizedUnit, number>> = {
    MILLIMETRE: 1,
    METRE: 1000,
  };
  for (const table of [mass, vol, len]) {
    if (from in table && to in table) {
      return (table[from] as number) / (table[to] as number);
    }
  }
  return null;
}
