/**
 * Normalize RFQ line items into purchasable BOQ lines.
 * Original tender wording is preserved separately — never destroyed.
 */

export type RawBoqLine = {
  lineNumber: number;
  description: string;
  specification?: string | null;
  brandRequirement?: string | null;
  model?: string | null;
  quantity: number;
  unit: string;
  equivalentAllowed?: boolean;
  mandatoryCharacteristics?: string | null;
  deliveryDestination?: string | null;
  notes?: string | null;
};

export type NormalizedBoqLine = {
  lineNumber: number;
  /** Verbatim tender wording — never overwritten by AI. */
  originalWording: string;
  description: string;
  quantity: number;
  unit: string;
  packSize: number | null;
  brandRequirement: string | null;
  modelRequirement: string | null;
  technicalSpecifications: string[];
  minimumAcceptableSpecification: string | null;
  equivalentAllowed: boolean;
  deliveryRequirement: string | null;
  mandatoryAttributes: string[];
  optionalAttributes: string[];
  normalizationConfidence: number;
  warnings: string[];
};

const PACK_RE =
  /\b(?:pack(?:s)?\s+of|x)\s*(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*(?:ml|g|kg|m|meter|metre|l)\b/i;

const SIZE_TOKENS =
  /\b(\d+(?:\.\d+)?)\s*(ml|g|kg|mm|m|meter|metre|l|volt|v|aa|aaa)\b/gi;

export function normalizeBoqLine(raw: RawBoqLine): NormalizedBoqLine {
  const warnings: string[] = [];
  const originalWording = raw.description.trim();
  const tech: string[] = [];
  const mandatory: string[] = [];
  const optional: string[] = [];

  if (raw.specification?.trim()) {
    tech.push(raw.specification.trim());
  }
  if (raw.mandatoryCharacteristics?.trim()) {
    for (const part of raw.mandatoryCharacteristics.split(/[;|]/)) {
      const t = part.trim();
      if (t) mandatory.push(t);
    }
  }

  let match: RegExpExecArray | null;
  const sizeRe = new RegExp(SIZE_TOKENS.source, "gi");
  while ((match = sizeRe.exec(originalWording)) !== null) {
    tech.push(`${match[1]}${match[2].toLowerCase()}`);
  }

  const brand =
    raw.brandRequirement?.trim() ||
    extractBrandHint(originalWording) ||
    null;
  if (brand) mandatory.push(`brand:${brand}`);

  const model = raw.model?.trim() || null;
  if (model) mandatory.push(`model:${model}`);

  let packSize: number | null = null;
  const packMatch = originalWording.match(PACK_RE);
  if (packMatch) {
    const n = Number(packMatch[1] || packMatch[2]);
    if (Number.isFinite(n) && n > 0) packSize = n;
  }

  if (!raw.unit?.trim()) {
    warnings.push("Unit missing — defaulted to EA without inventing pack semantics");
  }

  const confidence =
    tech.length > 0 || brand || model
      ? 0.75
      : originalWording.length > 8
        ? 0.55
        : 0.35;

  if (confidence < 0.5) {
    warnings.push("Low normalization confidence — preserve for review");
  }

  return {
    lineNumber: raw.lineNumber,
    originalWording,
    description: originalWording,
    quantity: Number(raw.quantity),
    unit: raw.unit?.trim() || "EA",
    packSize,
    brandRequirement: brand,
    modelRequirement: model,
    technicalSpecifications: [...new Set(tech)],
    minimumAcceptableSpecification: tech[0] ?? null,
    equivalentAllowed: raw.equivalentAllowed !== false,
    deliveryRequirement: raw.deliveryDestination?.trim() || null,
    mandatoryAttributes: [...new Set(mandatory)],
    optionalAttributes: optional,
    normalizationConfidence: confidence,
    warnings,
  };
}

export function normalizeBoq(lines: RawBoqLine[]): NormalizedBoqLine[] {
  return lines
    .slice()
    .sort((a, b) => a.lineNumber - b.lineNumber)
    .map(normalizeBoqLine);
}

function extractBrandHint(text: string): string | null {
  const m = text.match(/\b(Duracell|Energizer|Sunlight|Makro|Staedtler)\b/i);
  return m?.[1] ?? null;
}

/**
 * Required purchase packs given tender qty and supplier pack size.
 * Prevents pricing one pack as N units.
 */
export function requiredPacks(
  tenderQuantity: number,
  supplierPackSize: number,
): {
  packs: number;
  remainder: number;
  exact: boolean;
  flag: "OK" | "PACK_SIZE_AMBIGUITY" | "INVALID_PACK";
} {
  if (!(supplierPackSize > 0) || !Number.isFinite(supplierPackSize)) {
    return {
      packs: 0,
      remainder: tenderQuantity,
      exact: false,
      flag: "INVALID_PACK",
    };
  }
  if (!(tenderQuantity > 0)) {
    return { packs: 0, remainder: 0, exact: true, flag: "OK" };
  }
  const packs = Math.ceil(tenderQuantity / supplierPackSize);
  const covered = packs * supplierPackSize;
  const remainder = covered - tenderQuantity;
  const exact = remainder === 0;
  return {
    packs,
    remainder,
    exact,
    flag: exact ? "OK" : "PACK_SIZE_AMBIGUITY",
  };
}
