export const SPEC_MATCH_STATES = [
  "EXACT_MATCH",
  "COMPLIANT_EQUIVALENT",
  "POSSIBLE_MATCH",
  "NON_COMPLIANT",
  "UNKNOWN",
] as const;

export type SpecMatchState = (typeof SPEC_MATCH_STATES)[number];

export function evaluateSpecMatch(input: {
  rfqDescription: string;
  rfqBrand?: string | null;
  equivalentAllowed: boolean;
  offeredDescription: string;
  offeredBrand?: string | null;
}): SpecMatchState {
  const rfq = input.rfqDescription.toLowerCase();
  const offered = input.offeredDescription.toLowerCase();

  if (input.rfqBrand) {
    const required = input.rfqBrand.toLowerCase();
    const got = (input.offeredBrand ?? "").toLowerCase();
    if (!got.includes(required) && !offered.includes(required)) {
      return input.equivalentAllowed ? "POSSIBLE_MATCH" : "NON_COMPLIANT";
    }
    return "EXACT_MATCH";
  }

  const tokens = rfq.split(/\W+/).filter((t) => t.length > 3);
  const hits = tokens.filter((t) => offered.includes(t)).length;
  if (tokens.length > 0 && hits / tokens.length >= 0.7) {
    return input.equivalentAllowed ? "COMPLIANT_EQUIVALENT" : "EXACT_MATCH";
  }
  if (hits > 0) return "POSSIBLE_MATCH";
  return "UNKNOWN";
}
