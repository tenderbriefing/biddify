/**
 * Lightweight supplier credibility — no unsupported legitimacy claims.
 */

export const CREDIBILITY_BANDS = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type CredibilityBand = (typeof CREDIBILITY_BANDS)[number];

export type SupplierCredibility = {
  band: CredibilityBand;
  score: number; // 0–1
  signals: string[];
  autonomousEligible: boolean;
};

const ESTABLISHED_DOMAINS = [
  "takealot.com",
  "makro.co.za",
  "builders.co.za",
  "game.co.za",
  "incredible.co.za",
  "hirschs.co.za",
  "loot.co.za",
  "amazon.com",
  "amazon.co.za",
  "waltons.co.za",
  "officeonline.co.za",
  "pna.co.za",
];

export function assessSupplierCredibility(input: {
  sourceName: string;
  sourceUrl?: string | null;
  sourceType?: string | null;
  domain?: string | null;
  sourceQuality?: number | null;
  priceSuspicious?: boolean;
  pageStaleOrDead?: boolean;
  marketplaceSeller?: boolean;
}): SupplierCredibility {
  const signals: string[] = [];
  let score = 0.4;

  const domain = (
    input.domain ??
    extractDomain(input.sourceUrl) ??
    ""
  ).toLowerCase();

  if (ESTABLISHED_DOMAINS.some((d) => domain.endsWith(d))) {
    score += 0.35;
    signals.push(`Established SA retailer/distributor domain: ${domain}`);
  } else if (domain && /\.co\.za$|\.com$|\.net$/i.test(domain)) {
    score += 0.1;
    signals.push(`Valid business website domain: ${domain}`);
  }

  if (input.sourceQuality != null) {
    score += input.sourceQuality * 0.2;
    signals.push(`Source quality score ${input.sourceQuality.toFixed(2)}`);
  }

  if (/manufacturer|authorized|official\s*store/i.test(input.sourceName)) {
    score += 0.1;
    signals.push("Manufacturer/authorized naming signal");
  }

  if (input.marketplaceSeller) {
    score -= 0.1;
    signals.push("Marketplace seller identity — elevated caution");
  }

  if (input.priceSuspicious) {
    score -= 0.25;
    signals.push("Suspicious pricing signal");
  }

  if (input.pageStaleOrDead) {
    score -= 0.3;
    signals.push("Stale or dead product page");
  }

  if (!domain && !input.sourceUrl) {
    signals.push("No URL/domain — credibility UNKNOWN");
    return {
      band: "UNKNOWN",
      score: Math.max(0, Math.min(1, score * 0.5)),
      signals,
      autonomousEligible: false,
    };
  }

  score = Math.max(0, Math.min(1, score));
  let band: CredibilityBand;
  if (score >= 0.75) band = "HIGH";
  else if (score >= 0.5) band = "MEDIUM";
  else if (score >= 0.3) band = "LOW";
  else band = "UNKNOWN";

  return {
    band,
    score,
    signals,
    autonomousEligible: band === "HIGH" || band === "MEDIUM",
  };
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
