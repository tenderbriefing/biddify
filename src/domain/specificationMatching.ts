/**
 * Specification matching engine for autonomous product selection.
 * Keyword overlap alone is never sufficient for AUTO selection.
 */

export const SPEC_MATCH_VERDICTS = [
  "EXACT_MATCH",
  "ACCEPTABLE_EQUIVALENT",
  "POSSIBLE_MATCH",
  "MISMATCH",
  "INSUFFICIENT_INFORMATION",
] as const;

export type SpecMatchVerdict = (typeof SPEC_MATCH_VERDICTS)[number];

export type SpecMatchInput = {
  requiredDescription: string;
  requiredBrand?: string | null;
  requiredModel?: string | null;
  requiredAttributes?: string[];
  equivalentAllowed: boolean;
  candidateDescription: string;
  candidateBrand?: string | null;
  candidateModel?: string | null;
  candidateAttributes?: string[];
  candidateSpecText?: string | null;
};

export type AttributeComparison = {
  attribute: string;
  required: string | null;
  observed: string | null;
  result: "MATCH" | "ACCEPTABLE" | "CONFLICT" | "MISSING" | "NOT_REQUIRED";
  source: string;
};

export type SpecMatchResult = {
  verdict: SpecMatchVerdict;
  confidence: number;
  matchedAttributes: string[];
  missingAttributes: string[];
  conflictingAttributes: string[];
  reasoning: string;
  evidence: string[];
  /** True only for EXACT_MATCH / ACCEPTABLE_EQUIVALENT. */
  selectableAutomatically: boolean;
  attributeComparisons?: AttributeComparison[];
};

const SIZE_RE =
  /\b(\d+(?:\.\d+)?)\s*(ml|g|kg|mm|m|meter|metre|l|volt|v)\b/gi;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

function extractSizes(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(SIZE_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`${m[1]}${m[2].toLowerCase()}`);
  }
  // Battery sizes AA/AAA
  if (/\baaa\b/i.test(text)) out.push("aaa");
  else if (/\baa\b/i.test(text)) out.push("aa");
  return [...new Set(out)];
}

/**
 * Compare tender specification against a candidate product.
 * Never infer compliance merely from title similarity.
 * MISMATCH must never be selected. INSUFFICIENT_INFORMATION is not
 * auto-selected unless policy explicitly permits (V1/V2: does not).
 */
export function matchSpecification(input: SpecMatchInput): SpecMatchResult {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicting: string[] = [];
  const evidence: string[] = [];
  const attributeComparisons: AttributeComparison[] = [];
  const source = "candidate_product_page_or_listing";

  const requiredBlob = [
    input.requiredDescription,
    ...(input.requiredAttributes ?? []),
  ].join(" ");
  const candidateBlob = [
    input.candidateDescription,
    input.candidateSpecText ?? "",
    ...(input.candidateAttributes ?? []),
  ].join(" ");

  const reqSizes = extractSizes(requiredBlob);
  const candSizes = extractSizes(candidateBlob);
  for (const s of reqSizes) {
    if (candSizes.includes(s)) {
      matched.push(`size:${s}`);
      attributeComparisons.push({
        attribute: "size",
        required: s,
        observed: s,
        result: "MATCH",
        source,
      });
    } else {
      const sameUnit = candSizes.find(
        (c) => c.replace(/[\d.]+/, "") === s.replace(/[\d.]+/, ""),
      );
      if (sameUnit && sameUnit !== s) {
        conflicting.push(`size:${s} vs ${sameUnit}`);
        attributeComparisons.push({
          attribute: "size",
          required: s,
          observed: sameUnit,
          result: "CONFLICT",
          source,
        });
      } else {
        missing.push(`size:${s}`);
        attributeComparisons.push({
          attribute: "size",
          required: s,
          observed: candSizes[0] ?? null,
          result: "MISSING",
          source,
        });
      }
    }
  }

  const reqBrand = (input.requiredBrand ?? "").trim().toLowerCase();
  const candBrand = (input.candidateBrand ?? "").trim().toLowerCase();
  if (reqBrand) {
    if (
      candBrand.includes(reqBrand) ||
      candidateBlob.toLowerCase().includes(reqBrand)
    ) {
      matched.push(`brand:${reqBrand}`);
      attributeComparisons.push({
        attribute: "brand",
        required: reqBrand,
        observed: candBrand || reqBrand,
        result: "MATCH",
        source,
      });
    } else if (!input.equivalentAllowed) {
      conflicting.push(`brand:required ${reqBrand}, offered ${candBrand || "none"}`);
      attributeComparisons.push({
        attribute: "brand",
        required: reqBrand,
        observed: candBrand || null,
        result: "CONFLICT",
        source,
      });
    } else {
      missing.push(`brand:${reqBrand}`);
      evidence.push("Brand equivalent permitted — brand gap noted");
      attributeComparisons.push({
        attribute: "brand",
        required: reqBrand,
        observed: candBrand || null,
        result: "ACCEPTABLE",
        source,
      });
    }
  } else {
    attributeComparisons.push({
      attribute: "brand",
      required: null,
      observed: candBrand || null,
      result: "NOT_REQUIRED",
      source,
    });
  }

  const reqModel = (input.requiredModel ?? "").trim().toLowerCase();
  const candModel = (input.candidateModel ?? "").trim().toLowerCase();
  if (reqModel) {
    if (
      candModel.includes(reqModel) ||
      candidateBlob.toLowerCase().includes(reqModel)
    ) {
      matched.push(`model:${reqModel}`);
      attributeComparisons.push({
        attribute: "model",
        required: reqModel,
        observed: candModel || reqModel,
        result: "MATCH",
        source,
      });
    } else {
      missing.push(`model:${reqModel}`);
      attributeComparisons.push({
        attribute: "model",
        required: reqModel,
        observed: candModel || null,
        result: "MISSING",
        source,
      });
    }
  }

  // Chemistry / voltage extras when present in tender text
  for (const attr of ["alkaline", "1.5v", "1.5 volt"] as const) {
    if (requiredBlob.toLowerCase().includes(attr.replace(" ", ""))) {
      const obs = candidateBlob.toLowerCase().includes(attr.replace(" ", "")) ||
        candidateBlob.toLowerCase().includes(attr);
      attributeComparisons.push({
        attribute: attr.includes("1.5") ? "voltage" : "chemistry",
        required: attr,
        observed: obs ? attr : null,
        result: obs ? "MATCH" : "MISSING",
        source,
      });
      if (obs) matched.push(attr.includes("1.5") ? "voltage:1.5v" : "chemistry:alkaline");
    }
  }

  const reqTokens = tokenize(input.requiredDescription).filter(
    (t) => !["and", "the", "for", "with", "size"].includes(t),
  );
  const candLower = candidateBlob.toLowerCase();
  const tokenHits = reqTokens.filter((t) => candLower.includes(t));
  const tokenRatio =
    reqTokens.length === 0 ? 0 : tokenHits.length / reqTokens.length;
  if (tokenHits.length) {
    evidence.push(
      `Token overlap ${tokenHits.length}/${reqTokens.length} (${(tokenRatio * 100).toFixed(0)}%) — not sufficient alone`,
    );
  }

  const base = {
    matchedAttributes: matched,
    missingAttributes: missing,
    conflictingAttributes: conflicting,
    evidence,
    attributeComparisons,
  };

  if (conflicting.length > 0 && !input.equivalentAllowed) {
    return {
      ...base,
      verdict: "MISMATCH",
      confidence: 0.85,
      reasoning: `Conflicting mandatory attributes: ${conflicting.join("; ")}`,
      selectableAutomatically: false,
    };
  }

  if (conflicting.some((c) => c.startsWith("size:"))) {
    return {
      ...base,
      verdict: "MISMATCH",
      confidence: 0.8,
      reasoning: "Size/specification conflict with tender requirement",
      selectableAutomatically: false,
    };
  }

  const criticalMissing = missing.filter(
    (m) => m.startsWith("brand:") || m.startsWith("model:") || m.startsWith("size:"),
  );

  // Title similarity alone is insufficient
  if (tokenRatio < 0.25 && matched.length === 0) {
    return {
      ...base,
      verdict: "INSUFFICIENT_INFORMATION",
      confidence: 0.3,
      missingAttributes: missing.length ? missing : ["core description tokens"],
      reasoning:
        "Insufficient attribute evidence — title similarity alone is not compliance",
      selectableAutomatically: false,
    };
  }

  if (reqBrand && conflicting.some((c) => c.startsWith("brand:"))) {
    return {
      ...base,
      verdict: "MISMATCH",
      confidence: 0.9,
      reasoning: "Required brand not satisfied and equivalents not allowed",
      selectableAutomatically: false,
    };
  }

  if (
    reqBrand &&
    !matched.some((m) => m.startsWith("brand:")) &&
    input.equivalentAllowed &&
    tokenRatio >= 0.5 &&
    matched.length > 0
  ) {
    return {
      ...base,
      verdict: "ACCEPTABLE_EQUIVALENT",
      confidence: 0.65,
      reasoning:
        "Equivalent allowed; observed attributes align without exact brand match",
      selectableAutomatically: true,
    };
  }

  if (criticalMissing.length > 0 && matched.length < 2) {
    return {
      ...base,
      verdict: "INSUFFICIENT_INFORMATION",
      confidence: 0.45,
      reasoning: `Missing critical attributes: ${criticalMissing.join(", ")}`,
      selectableAutomatically: false,
    };
  }

  if (
    (reqBrand ? matched.some((m) => m.startsWith("brand:")) : true) &&
    (reqSizes.length === 0 || matched.some((m) => m.startsWith("size:"))) &&
    matched.length >= Math.max(1, Math.min(2, reqSizes.length + (reqBrand ? 1 : 0)))
  ) {
    return {
      ...base,
      verdict: "EXACT_MATCH",
      confidence: Math.min(0.95, 0.7 + matched.length * 0.05),
      reasoning: "Required material attributes observed on product evidence",
      selectableAutomatically: true,
    };
  }

  if (tokenRatio >= 0.45 || matched.length > 0) {
    return {
      ...base,
      verdict: "POSSIBLE_MATCH",
      confidence: 0.5,
      reasoning: "Partial match — requires human review before selection",
      selectableAutomatically: false,
    };
  }

  return {
    ...base,
    verdict: "INSUFFICIENT_INFORMATION",
    confidence: 0.35,
    missingAttributes: missing.length ? missing : ["specification detail"],
    reasoning: "Cannot confirm compliance from available candidate data",
    selectableAutomatically: false,
  };
}

/** V1 policy: never auto-select MISMATCH or INSUFFICIENT_INFORMATION. */
export function mayAutoSelect(verdict: SpecMatchVerdict): boolean {
  return verdict === "EXACT_MATCH" || verdict === "ACCEPTABLE_EQUIVALENT";
}
