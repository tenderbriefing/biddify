/**
 * Intelligent product search query generation from normalized BOQ attributes.
 * Never search only the raw tender string.
 */

export type BoqSearchAttributes = {
  lineNumber: number;
  description: string;
  brandRequirement?: string | null;
  modelRequirement?: string | null;
  technicalSpecifications?: string[];
  packSize?: number | null;
  unit?: string;
  categoryHint?: string | null;
  voltage?: string | null;
  sizeTokens?: string[];
};

export type GeneratedSearchQuery = {
  query: string;
  reason: string;
  lineNumber: number;
  timestamp: string;
};

const SA_CONTEXT = "South Africa";

export function generateProductSearchQueries(
  attrs: BoqSearchAttributes,
  maxQueries = 3,
): GeneratedSearchQuery[] {
  const now = new Date().toISOString();
  const brand = attrs.brandRequirement?.trim();
  const model = attrs.modelRequirement?.trim();
  const specs = (attrs.technicalSpecifications ?? []).filter(Boolean);
  const sizeBits = [
    ...(attrs.sizeTokens ?? []),
    ...specs.filter((s) => /\d/.test(s)),
  ].slice(0, 3);
  const core = cleanDescription(attrs.description);
  const category = attrs.categoryHint?.trim() || inferCategory(core);
  const out: GeneratedSearchQuery[] = [];

  const wantsPackLanguage =
    !/laptop|notebook|computer|monitor|desktop/i.test(core) &&
    (attrs.unit == null ||
      !["EA", "EACH", "UNIT"].includes(attrs.unit.toUpperCase()) ||
      /battery|pack|box|carton|ream|bottle|roll/i.test(core));

  // Short catalogue-friendly query first (retail APIs prefer concise terms)
  if (brand && category) {
    out.push({
      query: compact([brand, category].join(" ")),
      reason: "Short brand+category query for catalogue APIs",
      lineNumber: attrs.lineNumber,
      timestamp: now,
    });
  } else if (category) {
    out.push({
      query: compact(category),
      reason: "Short category query for catalogue APIs",
      lineNumber: attrs.lineNumber,
      timestamp: now,
    });
  }

  const primaryParts = [brand, model, core, ...sizeBits.slice(0, 2), SA_CONTEXT, "price"]
    .filter(Boolean)
    .join(" ");
  out.push({
    query: compact(primaryParts),
    reason: "Primary attribute search with SA commercial context",
    lineNumber: attrs.lineNumber,
    timestamp: now,
  });

  if (brand) {
    if (wantsPackLanguage) {
      out.push({
        query: compact(
          [brand, ...sizeBits, category || core, "pack", SA_CONTEXT].join(" "),
        ),
        reason: "Brand + pack sizing for procurement units",
        lineNumber: attrs.lineNumber,
        timestamp: now,
      });
    }
    out.push({
      query: compact(
        [brand, core, "supplier OR wholesaler OR distributor", SA_CONTEXT].join(
          " ",
        ),
      ),
      reason: "Prefer distributor/wholesaler discovery over marketplace",
      lineNumber: attrs.lineNumber,
      timestamp: now,
    });
  } else {
    out.push({
      query: compact(
        [core, ...sizeBits, category, "wholesaler OR makro OR trade", SA_CONTEXT].join(
          " ",
        ),
      ),
      reason: "Category/spec search biased to SA wholesale sources",
      lineNumber: attrs.lineNumber,
      timestamp: now,
    });
    out.push({
      query: compact([core, ...sizeBits, "buy online", SA_CONTEXT, "price"].join(" ")),
      reason: "Retail discovery fallback for unfamiliar products",
      lineNumber: attrs.lineNumber,
      timestamp: now,
    });
  }

  // Deduplicate queries
  const seen = new Set<string>();
  const unique = out.filter((q) => {
    const k = q.query.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return unique.slice(0, maxQueries);
}

function cleanDescription(text: string): string {
  return text
    .replace(/\b(or equivalent|as per|sample)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function inferCategory(text: string): string {
  const t = text.toLowerCase();
  if (/battery|duracell|energizer|aaa|aa\b/.test(t)) return "alkaline battery";
  if (/laptop|notebook/.test(t)) return "laptop";
  if (/dishwash|detergent/.test(t)) return "dishwashing liquid";
  if (/towel|paper/.test(t) && !/copy\s*paper|a4/.test(t)) return "paper towel";
  if (/cotton\s*wool/.test(t)) return "cotton wool";
  if (/copy\s*paper|a4.*paper|ream/.test(t)) return "A4 copy paper";
  if (/ballpoint|pen\b/.test(t)) return "ballpoint pens";
  if (/lever\s*arch|file\b/.test(t)) return "lever arch file";
  if (/vaccine/.test(t)) return "vaccine";
  return "";
}

function compact(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
