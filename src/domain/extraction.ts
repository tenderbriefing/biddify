/**
 * Structured RFQ document extraction.
 * Extracted values retain provenance and start as UNVERIFIED.
 */

export type ExtractedLineItem = {
  lineNumber: number;
  materialNumber?: string;
  description: string;
  specification?: string;
  brandRequirement?: string;
  quantity: number;
  unit: string;
  equivalentAllowed: boolean;
  mandatoryCharacteristics?: string;
  sourcePage?: string;
  sourceSection?: string;
  extractionMethod: string;
  confidence: number;
};

export type ExtractedRequirement = {
  category: string;
  requirementType: string;
  description: string;
  isMandatory: boolean;
  provenance: "SOURCE_FACT" | "HEURISTIC";
  sourcePage?: string;
  sourceSection?: string;
  notes?: string;
};

export type ExtractionResult = {
  lineItems: ExtractedLineItem[];
  requirements: ExtractedRequirement[];
  deliveryAddress?: string;
  deliveryDestination?: string;
  closingHint?: string;
  validityDays?: number;
  buyerContactName?: string;
  buyerContactPhone?: string;
  submissionHints: string[];
  warnings: string[];
  method: string;
};

/**
 * Johannesburg Water RFQ BOQ-style extraction (materials table + notes).
 * Conservative: only emit lines we can parse with quantity + description.
 */
export function extractJohannesburgWaterBoq(text: string): ExtractionResult {
  const warnings: string[] = [];
  const lineItems: ExtractedLineItem[] = [];
  const requirements: ExtractedRequirement[] = [];

  // Flatten whitespace so multiline BOQ rows (e.g. AA battery) still match.
  // JW PDFs often glue unit marker: "750MLEA", "500gEA", "batteryEA".
  const flattened = text.replace(/\s+/g, " ");
  const sectionMatch = flattened.match(
    /MATERIAL NUMBER[\s\S]{0,200}?(?=\d{1,5}\s+[A-Za-z])([\s\S]*?)(?=Mthetho|Notes:|Specific Goals|CONTACT PERSON)/i,
  );
  const section =
    sectionMatch?.[1] ??
    flattened.match(
      /(\d{1,5}\s+(?:DISHWASHING|TOWEL|Cotton|TOOL BATTERY|Size AAA)[\s\S]*?)(?=Mthetho|Notes:|Specific Goals)/i,
    )?.[1] ??
    "";

  if (!section) {
    warnings.push("Could not isolate JW materials table section");
  }

  // materialNo + description + EA + qty (EA may be glued to description)
  const rowRe =
    /(\d{1,5})\s+(.+?)EA\s+(\d{1,5})(?=\s+\d{1,5}\s+[A-Za-z]|\s+[A-Z][a-z]|\s*$)/gi;

  let match: RegExpExecArray | null;
  let lineNumber = 0;
  const seenMaterials = new Set<string>();
  const haystack = (section || flattened).trim();
  while ((match = rowRe.exec(haystack)) !== null) {
    const materialNumber = match[1]!.trim();
    if (seenMaterials.has(materialNumber)) continue;

    const description = match[2]!.trim().replace(/\s+/g, " ");
    if (description.length > 160 || description.length < 3) continue;
    if (!/[A-Za-z]{3,}/.test(description)) continue;

    const quantity = Number(match[3]);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) {
      warnings.push(`Skipped material ${materialNumber}: invalid quantity`);
      continue;
    }

    if (
      /johannesburg|quotation|mandatory|declaration|preferential|directors|telephone|closing/i.test(
        description,
      )
    ) {
      continue;
    }

    seenMaterials.add(materialNumber);
    lineNumber += 1;

    let brandRequirement: string | undefined;
    const duracell = /duracell/i.test(description);
    if (duracell) {
      brandRequirement = "Duracell";
    }

    let specification = description;
    if (/750\s*ml/i.test(description)) {
      specification = "750ml dishwashing liquid";
    } else if (/280\s*mm/i.test(description) && /1500/i.test(description)) {
      specification = "Paper towel 280mm x 1500 metre";
    } else if (/cotton\s+wool/i.test(description) && /500\s*g/i.test(description)) {
      specification = "Cotton wool roll 500g";
    } else if (/\bAA\b/i.test(description)) {
      specification = "General purpose penlight battery 1.5V AA";
    } else if (/\bAAA\b/i.test(description)) {
      specification = "Size AAA battery" + (duracell ? " (Duracell)" : "");
    }

    lineItems.push({
      lineNumber,
      materialNumber,
      description,
      specification,
      brandRequirement,
      quantity,
      unit: "EA",
      equivalentAllowed: !duracell,
      mandatoryCharacteristics: duracell
        ? "Brand Duracell required as stated in RFQ description"
        : "Manufacturer name and datasheet required",
      sourceSection: "MATERIAL / BOQ table",
      extractionMethod: "HEURISTIC_JW_BOQ_REGEX",
      confidence: 0.82,
    });
  }

  if (lineItems.length === 0) {
    warnings.push("No BOQ line items matched JW EA-quantity pattern");
  }

  if (/manufacture datasheet|manufacturer datasheet/i.test(text)) {
    requirements.push({
      category: "Technical",
      requirementType: "DATASHEET",
      description:
        "Provide manufacturer datasheet and manufacturer names for all items. Failure results in disqualification.",
      isMandatory: true,
      provenance: "SOURCE_FACT",
      sourceSection: "Notes",
      notes: "SOURCE FACT from RFQ notes",
    });
  }

  if (/brand names where required/i.test(text)) {
    requirements.push({
      category: "Commercial",
      requirementType: "BRAND",
      description: "Quotations without brand names where required will not be accepted.",
      isMandatory: true,
      provenance: "SOURCE_FACT",
    });
  }

  if (/sample units may be requested/i.test(text)) {
    requirements.push({
      category: "Technical",
      requirementType: "SAMPLE",
      description: "Sample units may be requested before proceeding with order.",
      isMandatory: false,
      provenance: "SOURCE_FACT",
    });
  }

  if (/central supplier database|\bCSD\b/i.test(text)) {
    requirements.push({
      category: "Compliance",
      requirementType: "CSD",
      description: "Supplier must be registered on Central Supplier Database (CSD).",
      isMandatory: true,
      provenance: "SOURCE_FACT",
    });
  }

  if (/MBD/i.test(text)) {
    requirements.push({
      category: "Compliance",
      requirementType: "MBD_FORMS",
      description: "Complete and sign attached MBD forms (MBD 4, 6.1, 8, 9 etc.).",
      isMandatory: true,
      provenance: "SOURCE_FACT",
    });
  }

  const submissionHints: string[] = [];
  if (/e-?tender portal|etenders\.gov\.za/i.test(text)) {
    submissionHints.push("Submit via eTenders portal using CSD credentials");
  }
  if (/company letterhead/i.test(text)) {
    submissionHints.push("Quotation must be on company letterhead (PDF)");
  }

  const contactPhone = text.match(/011\s*688\s*\d{4}/)?.[0];
  const validity = text.match(/VALIDITY\s+(\d+)/i)?.[1];

  return {
    lineItems,
    requirements,
    deliveryAddress: /65\s+Ntemi\s+Piliso/i.test(text)
      ? "Johannesburg Water / Cydna Lab — 65 Ntemi Piliso Street, Newtown / Marshalltown, Johannesburg"
      : undefined,
    deliveryDestination: /CYDNA\s+LAB/i.test(text) ? "Cydna Lab" : undefined,
    closingHint: /16\.10\.2026|12:00\s*pm/i.test(text)
      ? "16.10.2026 12:00pm (from RFQ form)"
      : undefined,
    validityDays: validity ? Number(validity) : undefined,
    buyerContactPhone: contactPhone,
    submissionHints,
    warnings,
    method: "HEURISTIC_JW_BOQ",
  };
}

export function extractRfqDocument(
  text: string,
  hints?: { buyer?: string; title?: string },
): ExtractionResult {
  const buyer = (hints?.buyer ?? "").toLowerCase();
  if (buyer.includes("johannesburg water") || /MATERIAL NUMBERDESCRIPTIONBRAND/i.test(text)) {
    return extractJohannesburgWaterBoq(text);
  }

  return {
    lineItems: [],
    requirements: [],
    submissionHints: [],
    warnings: [
      "No specialised extractor matched — manual extraction required",
    ],
    method: "NONE",
  };
}
