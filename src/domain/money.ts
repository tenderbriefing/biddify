/** Money helpers — ZAR cents precision (2 decimal places). Never invent prices. */

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Invalid money value: not finite");
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toNumber(value: number | string): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) {
    throw new Error("Invalid numeric value");
  }
  return n;
}
