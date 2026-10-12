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
 * MISMATCH must never be selected. INSUFFICIENT_INFORMATION is not
 * auto-selected unless policy explicitly permits (V1: does not).
 */
export function matchSpecification(input: SpecMatchInput): SpecMatchResult {
  const matched: string[] = [];
  const missing: string[] = [];
  const conflicting: string[] = [];
  const evidence: string[] = [];

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
    if (candSizes.includes(s)) matched.push(`size:${s}`);
    else {
      // Soft mismatch on size when candidate has a conflicting size
      const sameUnit = candSizes.find(
        (c) => c.replace(/[\d.]+/, "") === s.replace(/[\d.]+/, ""),
      );
      if (sameUnit && sameUnit !== s) {
        conflicting.push(`size:${s} vs ${sameUnit}`);
      } else {
        missing.push(`size:${s}`);
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
    } else if (!input.equivalentAllowed) {
      conflicting.push(`brand:required ${reqBrand}, offered ${candBrand || "none"}`);
    } else {
      missing.push(`brand:${reqBrand}`);
      evidence.push("Brand equivalent permitted — brand gap noted");
    }
  }

  const reqModel = (input.requiredModel ?? "").trim().toLowerCase();
  const candModel = (input.candidateModel ?? "").trim().toLowerCase();
  if (reqModel) {
    if (
      candModel.includes(reqModel) ||
      candidateBlob.toLowerCase().includes(reqModel)
    ) {
      matched.push(`model:${reqModel}`);
    } else {
      missing.push(`model:${reqModel}`);
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
      `Token overlap ${tokenHits.length}/${reqTokens.length} (${(tokenRatio * 100).toFixed(0)}%)`,
    );
  }

  if (conflicting.length > 0 && !input.equivalentAllowed) {
    return {
      verdict: "MISMATCH",
      confidence: 0.85,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: `Conflicting mandatory attributes: ${conflicting.join("; ")}`,
      evidence,
      selectableAutomatically: false,
    };
  }

  if (conflicting.some((c) => c.startsWith("size:"))) {
    return {
      verdict: "MISMATCH",
      confidence: 0.8,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: "Size/specification conflict with tender requirement",
      evidence,
      selectableAutomatically: false,
    };
  }

  const criticalMissing = missing.filter(
    (m) => m.startsWith("brand:") || m.startsWith("model:") || m.startsWith("size:"),
  );

  if (tokenRatio < 0.25 && matched.length === 0) {
    return {
      verdict: "INSUFFICIENT_INFORMATION",
      confidence: 0.3,
      matchedAttributes: matched,
      missingAttributes: missing.length ? missing : ["core description tokens"],
      conflictingAttributes: conflicting,
      reasoning:
        "Insufficient overlapping specification evidence — do not auto-select",
      evidence,
      selectableAutomatically: false,
    };
  }

  if (reqBrand && conflicting.some((c) => c.startsWith("brand:"))) {
    return {
      verdict: "MISMATCH",
      confidence: 0.9,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: "Required brand not satisfied and equivalents not allowed",
      evidence,
      selectableAutomatically: false,
    };
  }

  if (
    reqBrand &&
    !matched.some((m) => m.startsWith("brand:")) &&
    input.equivalentAllowed &&
    tokenRatio >= 0.5
  ) {
    return {
      verdict: "ACCEPTABLE_EQUIVALENT",
      confidence: 0.65,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning:
        "Equivalent allowed; core attributes align without exact brand match",
      evidence,
      selectableAutomatically: true,
    };
  }

  if (criticalMissing.length > 0 && tokenRatio < 0.7) {
    return {
      verdict: "INSUFFICIENT_INFORMATION",
      confidence: 0.45,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: `Missing critical attributes: ${criticalMissing.join(", ")}`,
      evidence,
      selectableAutomatically: false,
    };
  }

  if (
    (reqBrand ? matched.some((m) => m.startsWith("brand:")) : true) &&
    (reqSizes.length === 0 || matched.some((m) => m.startsWith("size:"))) &&
    tokenRatio >= 0.7
  ) {
    return {
      verdict: "EXACT_MATCH",
      confidence: Math.min(0.95, 0.7 + tokenRatio * 0.25),
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: "Required attributes and description tokens align",
      evidence,
      selectableAutomatically: true,
    };
  }

  if (tokenRatio >= 0.45 || matched.length > 0) {
    return {
      verdict: "POSSIBLE_MATCH",
      confidence: 0.5,
      matchedAttributes: matched,
      missingAttributes: missing,
      conflictingAttributes: conflicting,
      reasoning: "Partial match — requires human review before selection",
      evidence,
      selectableAutomatically: false,
    };
  }

  return {
    verdict: "INSUFFICIENT_INFORMATION",
    confidence: 0.35,
    matchedAttributes: matched,
    missingAttributes: missing.length ? missing : ["specification detail"],
    conflictingAttributes: conflicting,
    reasoning: "Cannot confirm compliance from available candidate data",
    evidence,
    selectableAutomatically: false,
  };
}

/** V1 policy: never auto-select MISMATCH or INSUFFICIENT_INFORMATION. */
export function mayAutoSelect(verdict: SpecMatchVerdict): boolean {
  return verdict === "EXACT_MATCH" || verdict === "ACCEPTABLE_EQUIVALENT";
}
