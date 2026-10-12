/**
 * Classify commercial source quality for live research evidence.
 * Highest search rank ≠ best evidence. Lowest price ≠ best source.
 */

export const SOURCE_TYPES = [
  "MANUFACTURER",
  "AUTHORIZED_DISTRIBUTOR",
  "DISTRIBUTOR",
  "WHOLESALER",
  "SPECIALIST_SUPPLIER",
  "RETAILER",
  "MARKETPLACE",
  "UNKNOWN",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export type SourceClassification = {
  domain: string;
  sourceType: SourceType;
  qualityScore: number; // 0–1
  reason: string;
};

const DOMAIN_RULES: Array<{
  match: RegExp;
  type: SourceType;
  score: number;
  reason: string;
}> = [
  {
    match: /duracell\.com|energizer\.com|hp\.com|dell\.com|lenovo\.com/i,
    type: "MANUFACTURER",
    score: 0.95,
    reason: "Manufacturer domain",
  },
  {
    match: /makro\.co\.za|trade\.makro/i,
    type: "WHOLESALER",
    score: 0.88,
    reason: "Established SA wholesaler",
  },
  {
    match: /builders\.co\.za|cashbuild\.co\.za|waltons\.co\.za|pna\.co\.za/i,
    type: "RETAILER",
    score: 0.78,
    reason: "Major established SA retailer",
  },
  {
    match: /takealot\.com/i,
    type: "MARKETPLACE",
    score: 0.62,
    reason: "Large SA marketplace — usable but not preferred primary",
  },
  {
    match: /amazon\.|ebay\.|aliexpress\./i,
    type: "MARKETPLACE",
    score: 0.35,
    reason: "Global marketplace — weak for SA tender procurement",
  },
  {
    match: /incredible\.co\.za|evetech\.co\.za|rectron\.co\.za|mustek\.co\.za/i,
    type: "SPECIALIST_SUPPLIER",
    score: 0.82,
    reason: "SA specialist ICT/distributor retailer",
  },
  {
    match: /bidvest|waltons|geewiz|wantitall/i,
    type: "DISTRIBUTOR",
    score: 0.8,
    reason: "SA distributor / catalogue seller",
  },
];

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function classifySource(urlOrDomain: string): SourceClassification {
  const domain = urlOrDomain.includes("/")
    ? extractDomain(urlOrDomain)
    : urlOrDomain.replace(/^www\./, "").toLowerCase();

  for (const rule of DOMAIN_RULES) {
    if (rule.match.test(domain)) {
      return {
        domain,
        sourceType: rule.type,
        qualityScore: rule.score,
        reason: rule.reason,
      };
    }
  }

  if (/\.co\.za$/i.test(domain)) {
    return {
      domain,
      sourceType: "RETAILER",
      qualityScore: 0.55,
      reason: "Unknown SA commercial domain — treat as retailer until proven",
    };
  }

  return {
    domain,
    sourceType: "UNKNOWN",
    qualityScore: 0.3,
    reason: "Unclassified source",
  };
}

export function evidenceLevelForSource(
  type: SourceType,
):
  | "DISTRIBUTOR_WEB_PRICE"
  | "WHOLESALER_WEB_PRICE"
  | "RETAIL_WEB_PRICE"
  | "PUBLIC_PRICE_REFERENCE" {
  switch (type) {
    case "MANUFACTURER":
    case "AUTHORIZED_DISTRIBUTOR":
    case "DISTRIBUTOR":
      return "DISTRIBUTOR_WEB_PRICE";
    case "WHOLESALER":
      return "WHOLESALER_WEB_PRICE";
    case "SPECIALIST_SUPPLIER":
    case "RETAILER":
      return "RETAIL_WEB_PRICE";
    default:
      return "PUBLIC_PRICE_REFERENCE";
  }
}
