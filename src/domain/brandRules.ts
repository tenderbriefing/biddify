/**
 * Brand requirement interpretation from tender language.
 */

export const BRAND_RULES = [
  "MANDATORY_BRAND",
  "BRAND_OR_EQUIVALENT",
  "REFERENCE_BRAND",
  "NO_BRAND_REQUIREMENT",
  "UNKNOWN",
] as const;

export type BrandRule = (typeof BRAND_RULES)[number];

export type BrandRuleResult = {
  rule: BrandRule;
  brand: string | null;
  evidence: string;
  equivalentAllowed: boolean;
};

export function interpretBrandRequirement(input: {
  description: string;
  brandRequirement?: string | null;
  equivalentAllowedFlag?: boolean | null;
  documentHints?: string[];
}): BrandRuleResult {
  const text = [
    input.description,
    input.brandRequirement ?? "",
    ...(input.documentHints ?? []),
  ].join(" ");

  const brand =
    input.brandRequirement?.trim() ||
    text.match(
      /\b(Duracell|Energizer|HP|Dell|Lenovo|Apple|Samsung|Epson|Brother)\b/i,
    )?.[1] ||
    null;

  if (!brand) {
    return {
      rule: "NO_BRAND_REQUIREMENT",
      brand: null,
      evidence: "No brand stated on line or nearby tender text",
      equivalentAllowed: true,
    };
  }

  if (/or\s+equivalent|approved\s+equivalent|similar\s+approved/i.test(text)) {
    return {
      rule: "BRAND_OR_EQUIVALENT",
      brand,
      evidence: `Brand ${brand} with explicit equivalent language`,
      equivalentAllowed: true,
    };
  }

  if (/reference\s+brand|example\s+brand|e\.g\.|eg\./i.test(text)) {
    return {
      rule: "REFERENCE_BRAND",
      brand,
      evidence: `Brand ${brand} appears as reference/example`,
      equivalentAllowed: true,
    };
  }

  if (input.equivalentAllowedFlag === false) {
    return {
      rule: "MANDATORY_BRAND",
      brand,
      evidence: `Brand ${brand} mandatory — equivalents disallowed on line`,
      equivalentAllowed: false,
    };
  }

  // Brand present without equivalent language → mandatory
  if (input.brandRequirement?.trim()) {
    return {
      rule: "MANDATORY_BRAND",
      brand,
      evidence: `Brand ${brand} stated without equivalent language`,
      equivalentAllowed: false,
    };
  }

  return {
    rule: "UNKNOWN",
    brand,
    evidence: `Brand ${brand} detected heuristically — treat cautiously`,
    equivalentAllowed: true,
  };
}
