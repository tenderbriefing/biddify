/**
 * Deep document understanding for Supply & Deliver RFQs.
 * Do not invent missing requirements — store confidence + evidence.
 */

export type DocumentUnderstandingInput = {
  title: string;
  description?: string | null;
  tenderNumber?: string | null;
  buyer: string;
  closingAt: Date;
  closingTimeKnown: boolean;
  deliveryAddress?: string | null;
  deliveryPeriod?: string | null;
  briefingDate?: Date | null;
  briefingCompulsory: boolean;
  briefingCompulsoryKnown: boolean;
  paymentTerms?: string | null;
  documentTexts: Array<{ fileName: string; text: string | null }>;
  existingRequirements: Array<{
    category: string;
    description: string;
    isMandatory: boolean;
  }>;
};

export type UnderstoodRequirement = {
  key: string;
  value: string | null;
  confidence: number;
  evidence: string;
  invented: false;
};

export type DocumentUnderstandingResult = {
  rfqNumber: string | null;
  institution: string;
  closingDateTime: string;
  closingTimeKnown: boolean;
  deliveryAddress: string | null;
  deliveryDeadline: string | null;
  validityPeriod: string | null;
  compulsoryBriefing: boolean | null;
  csdRequirements: string[];
  taxRequirements: string[];
  bbbeeRequirements: string[];
  mandatoryForms: string[];
  mbdForms: string[];
  declarations: string[];
  signatures: string[];
  pricingSchedules: string[];
  evaluationCriteria: string[];
  functionalityRequirements: string[];
  requiredCertifications: string[];
  brands: string[];
  modelNumbers: string[];
  orEquivalentClauses: string[];
  specialConditions: string[];
  fields: UnderstoodRequirement[];
  overallConfidence: number;
  warnings: string[];
};

function findInDocs(
  docs: DocumentUnderstandingInput["documentTexts"],
  re: RegExp,
): { match: string; fileName: string } | null {
  for (const d of docs) {
    if (!d.text) continue;
    const m = d.text.match(re);
    if (m) return { match: m[0], fileName: d.fileName };
  }
  return null;
}

function collectMatches(
  docs: DocumentUnderstandingInput["documentTexts"],
  re: RegExp,
): string[] {
  const out: string[] = [];
  for (const d of docs) {
    if (!d.text) continue;
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    let m: RegExpExecArray | null;
    while ((m = global.exec(d.text)) !== null) {
      out.push(m[1] ?? m[0]);
    }
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

export function understandDocuments(
  input: DocumentUnderstandingInput,
): DocumentUnderstandingResult {
  const warnings: string[] = [];
  const fields: UnderstoodRequirement[] = [];
  const docs = input.documentTexts;

  const rfqNumber = input.tenderNumber ?? null;
  fields.push({
    key: "rfqNumber",
    value: rfqNumber,
    confidence: rfqNumber ? 0.95 : 0.2,
    evidence: rfqNumber ? "RFQ tenderNumber field" : "Not present on RFQ record",
    invented: false,
  });
  if (!rfqNumber) warnings.push("RFQ number not found — not invented");

  const institution = input.buyer;
  fields.push({
    key: "institution",
    value: institution,
    confidence: 0.95,
    evidence: "RFQ buyer field",
    invented: false,
  });

  const closingDateTime = input.closingAt.toISOString();
  fields.push({
    key: "closingDateTime",
    value: closingDateTime,
    confidence: input.closingTimeKnown ? 0.95 : 0.6,
    evidence: input.closingTimeKnown
      ? "RFQ closingAt with known time"
      : "RFQ closingAt — time not known from source",
    invented: false,
  });

  const deliveryAddress = input.deliveryAddress ?? null;
  fields.push({
    key: "deliveryAddress",
    value: deliveryAddress,
    confidence: deliveryAddress ? 0.85 : 0.2,
    evidence: deliveryAddress
      ? "RFQ deliveryAddress"
      : "Delivery address not on record",
    invented: false,
  });

  const deliveryDeadline = input.deliveryPeriod ?? null;
  fields.push({
    key: "deliveryDeadline",
    value: deliveryDeadline,
    confidence: deliveryDeadline ? 0.7 : 0.2,
    evidence: deliveryDeadline
      ? "RFQ deliveryPeriod"
      : "Delivery deadline not stated",
    invented: false,
  });

  const validityHit = findInDocs(docs, /valid(?:ity)?\s*(?:period|for)?[:\s]+(\d+\s*days?)/i);
  const validityPeriod = validityHit?.match ?? null;
  fields.push({
    key: "validityPeriod",
    value: validityPeriod,
    confidence: validityPeriod ? 0.7 : 0.2,
    evidence: validityHit
      ? `Document ${validityHit.fileName}`
      : "Validity period not found — not invented",
    invented: false,
  });

  let compulsoryBriefing: boolean | null = null;
  if (input.briefingCompulsoryKnown) {
    compulsoryBriefing = input.briefingCompulsory;
  }
  fields.push({
    key: "compulsoryBriefing",
    value:
      compulsoryBriefing == null
        ? null
        : compulsoryBriefing
          ? "YES"
          : "NO",
    confidence: compulsoryBriefing == null ? 0.3 : 0.9,
    evidence:
      compulsoryBriefing == null
        ? "Briefing compulsoriness unknown from source"
        : "RFQ briefingCompulsory flag",
    invented: false,
  });

  const csdRequirements = [
    ...collectMatches(docs, /\b(CSD[^\n.]{0,80})/gi),
    ...input.existingRequirements
      .filter((r) => /csd/i.test(r.category) || /csd/i.test(r.description))
      .map((r) => r.description),
  ];
  const taxRequirements = [
    ...collectMatches(docs, /\b(tax\s+clearance[^\n.]{0,60}|PIN[^\n.]{0,40})/gi),
    ...input.existingRequirements
      .filter((r) => /tax/i.test(r.category) || /tax/i.test(r.description))
      .map((r) => r.description),
  ];
  const bbbeeRequirements = [
    ...collectMatches(docs, /\b(B-?BBEE[^\n.]{0,80}|specific\s+goals[^\n.]{0,80})/gi),
  ];
  const mbdForms = collectMatches(docs, /\b(MBD\s*\d+[A-Z]?)\b/gi);
  const mandatoryForms = [
    ...mbdForms,
    ...collectMatches(docs, /\b(SBD\s*\d+[A-Z]?)\b/gi),
  ];
  const declarations = collectMatches(
    docs,
    /\b(declaration\s+of\s+interest|declaration\s+of\s+bidder[^\n.]{0,40})/gi,
  );
  const signatures = collectMatches(
    docs,
    /\b(authorised\s+signatory|signature\s+required|duly\s+authorised)/gi,
  );
  const pricingSchedules = collectMatches(
    docs,
    /\b(pricing\s+schedule|bill\s+of\s+quantities|BOQ|quotation\s+schedule)/gi,
  );
  const evaluationCriteria = collectMatches(
    docs,
    /\b(evaluation\s+criteria|preferential\s+points|80\/20|90\/10)/gi,
  );
  const functionalityRequirements = collectMatches(
    docs,
    /\b(functionality|technical\s+evaluation)[^\n.]{0,60}/gi,
  );
  const requiredCertifications = collectMatches(
    docs,
    /\b(ISO\s*\d+|SANS\s*\d+|OEM\s+authori[sz]ation|letter\s+of\s+authority)/gi,
  );
  const brands = collectMatches(docs, /\bbrand[:\s]+([A-Za-z0-9][A-Za-z0-9 &\-]{1,40})/gi);
  const modelNumbers = collectMatches(
    docs,
    /\b(?:model|sku)[:\s]+([A-Za-z0-9][A-Za-z0-9\-]{1,30})/gi,
  );
  const orEquivalentClauses = collectMatches(
    docs,
    /\b(or\s+equivalent|approved\s+equivalent)/gi,
  );
  const specialConditions = collectMatches(
    docs,
    /\b(special\s+condition[s]?[^\n.]{0,100})/gi,
  );

  if (docs.every((d) => !d.text)) {
    warnings.push("No extracted document text available — understanding limited to RFQ fields");
  }

  const knownCount = fields.filter((f) => f.value != null).length;
  const overallConfidence = Math.min(
    0.95,
    0.35 + knownCount * 0.08 + (docs.some((d) => d.text) ? 0.15 : 0),
  );

  return {
    rfqNumber,
    institution,
    closingDateTime,
    closingTimeKnown: input.closingTimeKnown,
    deliveryAddress,
    deliveryDeadline,
    validityPeriod,
    compulsoryBriefing,
    csdRequirements: [...new Set(csdRequirements)],
    taxRequirements: [...new Set(taxRequirements)],
    bbbeeRequirements: [...new Set(bbbeeRequirements)],
    mandatoryForms: [...new Set(mandatoryForms)],
    mbdForms: [...new Set(mbdForms)],
    declarations: [...new Set(declarations)],
    signatures: [...new Set(signatures)],
    pricingSchedules: [...new Set(pricingSchedules)],
    evaluationCriteria: [...new Set(evaluationCriteria)],
    functionalityRequirements: [...new Set(functionalityRequirements)],
    requiredCertifications: [...new Set(requiredCertifications)],
    brands: [...new Set(brands)],
    modelNumbers: [...new Set(modelNumbers)],
    orEquivalentClauses: [...new Set(orEquivalentClauses)],
    specialConditions: [...new Set(specialConditions)],
    fields,
    overallConfidence,
    warnings,
  };
}
