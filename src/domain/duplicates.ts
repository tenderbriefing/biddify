/**
 * Duplicate detection — never silently delete.
 * Exact source duplicates are prevented by (source, sourceOpportunityId).
 * Probable cross-source / title matches are linked for review.
 */

export type DuplicateCandidate = {
  id: string;
  source: string;
  sourceOpportunityId?: string | null;
  tenderNumber?: string | null;
  title: string;
  buyer: string;
  closingAt: Date;
  selectedCompanyId?: string | null;
};

export type DuplicateMatch = {
  leftId: string;
  rightId: string;
  kind: "EXACT_SOURCE" | "SAME_TENDER_NUMBER" | "PROBABLE_TITLE";
  confidence: number;
  explanation: string;
  sameOpportunityDifferentCompanies: boolean;
};

export function detectDuplicates(
  candidates: DuplicateCandidate[],
): DuplicateMatch[] {
  const matches: DuplicateMatch[] = [];

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;

      if (
        a.source === b.source &&
        a.sourceOpportunityId &&
        a.sourceOpportunityId === b.sourceOpportunityId
      ) {
        matches.push({
          leftId: a.id,
          rightId: b.id,
          kind: "EXACT_SOURCE",
          confidence: 1,
          explanation: `Exact source identity ${a.source}::${a.sourceOpportunityId}`,
          sameOpportunityDifferentCompanies: Boolean(
            a.selectedCompanyId &&
              b.selectedCompanyId &&
              a.selectedCompanyId !== b.selectedCompanyId,
          ),
        });
        continue;
      }

      if (
        a.tenderNumber &&
        b.tenderNumber &&
        normalizeTenderNumber(a.tenderNumber) ===
          normalizeTenderNumber(b.tenderNumber)
      ) {
        matches.push({
          leftId: a.id,
          rightId: b.id,
          kind: "SAME_TENDER_NUMBER",
          confidence: 0.92,
          explanation: `Same tender/RFQ number ${a.tenderNumber}`,
          sameOpportunityDifferentCompanies: Boolean(
            a.selectedCompanyId &&
              b.selectedCompanyId &&
              a.selectedCompanyId !== b.selectedCompanyId,
          ),
        });
        continue;
      }

      const titleSim = titleSimilarity(a.title, b.title);
      const buyerSim = titleSimilarity(a.buyer, b.buyer);
      const closeDays =
        Math.abs(a.closingAt.getTime() - b.closingAt.getTime()) /
        (24 * 3600 * 1000);

      if (titleSim >= 0.9 && buyerSim >= 0.7 && closeDays <= 2) {
        matches.push({
          leftId: a.id,
          rightId: b.id,
          kind: "PROBABLE_TITLE",
          confidence: Math.min(0.95, (titleSim + buyerSim) / 2),
          explanation: `Probable duplicate — title/buyer similarity with closing dates ${closeDays.toFixed(1)}d apart`,
          sameOpportunityDifferentCompanies: Boolean(
            a.selectedCompanyId &&
              b.selectedCompanyId &&
              a.selectedCompanyId !== b.selectedCompanyId,
          ),
        });
      }
    }
  }

  return matches;
}

export function normalizeTenderNumber(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function titleSimilarity(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

export function buildDuplicateGroupId(ids: string[]): string {
  return [...ids].sort().join("::");
}
