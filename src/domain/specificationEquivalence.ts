/**
 * SpecificationEquivalence — structured compatibility beyond keyword overlap.
 * PARTIAL / AMBIGUOUS / INCOMPATIBLE cannot become autonomous procurement selections.
 */

import {
  matchSpecification,
  type SpecMatchInput,
  type SpecMatchVerdict,
} from "./specificationMatching";

export const SPEC_EQUIVALENCE_CLASSES = [
  "EXACT",
  "EQUIVALENT",
  "BETTER_THAN_REQUIRED",
  "PARTIAL",
  "AMBIGUOUS",
  "INCOMPATIBLE",
] as const;

export type SpecEquivalenceClass = (typeof SPEC_EQUIVALENCE_CLASSES)[number];

export type SpecEquivalenceInput = SpecMatchInput & {
  requiredPartNumber?: string | null;
  candidatePartNumber?: string | null;
  requiredCertifications?: string[];
  candidateCertifications?: string[];
  orEquivalentExplicit?: boolean;
};

export type SpecEquivalenceResult = {
  classification: SpecEquivalenceClass;
  compatibilityScore: number; // 0–1
  selectableForAutonomousProcurement: boolean;
  matchedDimensions: string[];
  conflictingDimensions: string[];
  missingDimensions: string[];
  partNumberExact: boolean;
  reasoning: string;
  /** Bridge to legacy SpecMatchVerdict for existing pipelines. */
  legacyVerdict: SpecMatchVerdict;
};

export function assessSpecificationEquivalence(
  input: SpecEquivalenceInput,
): SpecEquivalenceResult {
  const legacy = matchSpecification(input);
  const matchedDimensions = [...legacy.matchedAttributes];
  const conflictingDimensions = [...legacy.conflictingAttributes];
  const missingDimensions = [...legacy.missingAttributes];

  const reqPn = normalizePn(input.requiredPartNumber ?? input.requiredModel);
  const candPn = normalizePn(
    input.candidatePartNumber ?? input.candidateModel,
  );
  const partNumberExact = Boolean(reqPn && candPn && reqPn === candPn);
  if (partNumberExact) matchedDimensions.push("part_number");

  const orEq =
    input.orEquivalentExplicit === true || input.equivalentAllowed === true;

  // Refurbished / CPO when tender does not allow — not autonomous-selectable
  const candText = `${input.candidateDescription} ${input.candidateSpecText ?? ""}`;
  const reqText = `${input.requiredDescription} ${(input.requiredAttributes ?? []).join(" ")}`;
  if (
    /refurb|refurbished|certified\s*pre-?owned|\bcpo\b/i.test(candText) &&
    !/refurb|refurbished|pre-?owned/i.test(reqText)
  ) {
    return finish(
      "INCOMPATIBLE",
      0.2,
      false,
      matchedDimensions,
      [...conflictingDimensions, "condition_new_vs_refurbished"],
      missingDimensions,
      partNumberExact,
      "Candidate is refurbished/CPO but tender does not permit used equipment",
      "MISMATCH",
    );
  }

  // RAM under-spec for computers
  const reqRam = reqText.match(/(\d+)\s*gb\s*ram/i);
  const candRam = candText.match(/(\d+)\s*gb(?:\s*ram)?/i);
  if (
    reqRam &&
    candRam &&
    /laptop|notebook|computer|pc\b/i.test(reqText) &&
    Number(candRam[1]) < Number(reqRam[1])
  ) {
    return finish(
      "INCOMPATIBLE",
      0.25,
      false,
      matchedDimensions,
      [...conflictingDimensions, "ram_underspec"],
      missingDimensions,
      partNumberExact,
      `RAM under-spec: required ${reqRam[1]}GB, candidate ${candRam[1]}GB`,
      "MISMATCH",
    );
  }

  // Hard conflicts → INCOMPATIBLE
  if (legacy.verdict === "MISMATCH" || conflictingDimensions.length > 0) {
    return finish(
      "INCOMPATIBLE",
      Math.min(legacy.confidence, 0.25),
      false,
      matchedDimensions,
      conflictingDimensions,
      missingDimensions,
      partNumberExact,
      `Incompatible: ${legacy.reasoning}`,
      legacy.verdict,
    );
  }

  // Exact part number RFQ
  if (partNumberExact) {
    return finish(
      "EXACT",
      Math.max(legacy.confidence, 0.95),
      true,
      matchedDimensions,
      conflictingDimensions,
      missingDimensions,
      true,
      "Manufacturer part number exact match — strong weighting",
      "EXACT_MATCH",
    );
  }

  if (legacy.verdict === "EXACT_MATCH") {
    // Detect BETTER_THAN_REQUIRED (candidate exceeds size/capacity)
    const better = detectBetterThanRequired(input);
    if (better) {
      return finish(
        "BETTER_THAN_REQUIRED",
        Math.max(legacy.confidence, 0.88),
        true,
        [...matchedDimensions, ...better],
        conflictingDimensions,
        missingDimensions,
        partNumberExact,
        `Meets and exceeds required dimensions: ${better.join(", ")}`,
        "EXACT_MATCH",
      );
    }
    return finish(
      "EXACT",
      legacy.confidence,
      true,
      matchedDimensions,
      conflictingDimensions,
      missingDimensions,
      partNumberExact,
      legacy.reasoning,
      "EXACT_MATCH",
    );
  }

  if (legacy.verdict === "ACCEPTABLE_EQUIVALENT" && orEq) {
    return finish(
      "EQUIVALENT",
      legacy.confidence,
      true,
      matchedDimensions,
      conflictingDimensions,
      missingDimensions,
      partNumberExact,
      legacy.reasoning,
      "ACCEPTABLE_EQUIVALENT",
    );
  }

  if (legacy.verdict === "POSSIBLE_MATCH") {
    return finish(
      "PARTIAL",
      Math.min(legacy.confidence, 0.55),
      false,
      matchedDimensions,
      conflictingDimensions,
      missingDimensions,
      partNumberExact,
      `Partial match only — not autonomous-selectable. ${legacy.reasoning}`,
      "POSSIBLE_MATCH",
    );
  }

  // INSUFFICIENT_INFORMATION or unmatched equivalent
  return finish(
    "AMBIGUOUS",
    Math.min(legacy.confidence, 0.4),
    false,
    matchedDimensions,
    conflictingDimensions,
    missingDimensions,
    partNumberExact,
    `Ambiguous specification evidence — not autonomous-selectable. ${legacy.reasoning}`,
    legacy.verdict,
  );
}

function finish(
  classification: SpecEquivalenceClass,
  compatibilityScore: number,
  selectable: boolean,
  matched: string[],
  conflicting: string[],
  missing: string[],
  partNumberExact: boolean,
  reasoning: string,
  legacyVerdict: SpecMatchVerdict,
): SpecEquivalenceResult {
  return {
    classification,
    compatibilityScore,
    selectableForAutonomousProcurement: selectable,
    matchedDimensions: matched,
    conflictingDimensions: conflicting,
    missingDimensions: missing,
    partNumberExact,
    reasoning,
    legacyVerdict,
  };
}

function normalizePn(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  return raw.trim().toUpperCase().replace(/[\s\-_/]/g, "");
}

function detectBetterThanRequired(input: SpecEquivalenceInput): string[] {
  const better: string[] = [];
  const req = `${input.requiredDescription} ${(input.requiredAttributes ?? []).join(" ")}`;
  const cand = `${input.candidateDescription} ${input.candidateSpecText ?? ""}`;
  const reqRam = req.match(/(\d+)\s*gb\s*ram/i);
  const candRam = cand.match(/(\d+)\s*gb\s*ram/i);
  if (reqRam && candRam && Number(candRam[1]) > Number(reqRam[1])) {
    better.push("ram");
  }
  const reqSsd = req.match(/(\d+)\s*gb\s*ssd/i);
  const candSsd = cand.match(/(\d+)\s*gb\s*ssd/i);
  if (reqSsd && candSsd && Number(candSsd[1]) > Number(reqSsd[1])) {
    better.push("storage");
  }
  return better;
}

export function isAutonomousSpecSelectable(
  classification: SpecEquivalenceClass,
): boolean {
  return (
    classification === "EXACT" ||
    classification === "EQUIVALENT" ||
    classification === "BETTER_THAN_REQUIRED"
  );
}
