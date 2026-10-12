export type CompanyCandidate = {
  id: string;
  legalName: string;
  isDemo: boolean;
  dataMode: "TEST" | "OPERATIONAL";
  isActive: boolean;
  outboundSourcingEnabled: boolean;
  readinessOverall: "READY" | "ACTION_REQUIRED" | "UNKNOWN" | "NOT_APPLICABLE";
  readinessBlockers: string[];
  province?: string | null;
  commodityCategories?: string | null;
  commodityNotes?: string | null;
  hasMappedGmail: boolean;
  relatedCompanyGroupId?: string | null;
  vatStatusKnown: boolean;
};

export type CompanySelectionInput = {
  rfq: {
    isRealSource: boolean;
    isDemo: boolean;
    province?: string | null;
    category?: string | null;
    title: string;
    classification?: string | null;
  };
  companies: CompanyCandidate[];
};

export type CompanySelectionResult = {
  recommendedCompanyId?: string;
  alternatives: string[];
  reasoning: string[];
  blockers: string[];
  relatedCompanyRisk: boolean;
};

function commodityFit(company: CompanyCandidate, rfq: CompanySelectionInput["rfq"]): number {
  const hay = `${company.commodityCategories ?? ""} ${company.commodityNotes ?? ""} ${company.legalName}`.toLowerCase();
  const needle = `${rfq.title} ${rfq.category ?? ""}`.toLowerCase();
  let score = 0;
  if (/chemical|consumable|cleaning|supply|wholesale|general/i.test(hay)) score += 2;
  if (/chemical/i.test(company.legalName) && /consumable|cleaning|liquid|wool|battery|towel/i.test(needle))
    score += 3;
  if (/service/i.test(company.legalName) && /service/i.test(needle)) score += 1;
  if (company.province && rfq.province && company.province === rfq.province) score += 1;
  if (company.readinessOverall === "READY") score += 2;
  if (company.hasMappedGmail) score += 2;
  return score;
}

/**
 * Select best operational company. Never recommends DEMO.
 * Does not auto-select multiple related companies for the same RFQ.
 */
export function selectBiddingCompany(
  input: CompanySelectionInput,
): CompanySelectionResult {
  const reasoning: string[] = [];
  const blockers: string[] = [];

  if (input.rfq.isDemo || !input.rfq.isRealSource) {
    return {
      alternatives: [],
      reasoning: ["RFQ is not operational real-source — company selection skipped"],
      blockers: ["Not a real operational RFQ"],
      relatedCompanyRisk: false,
    };
  }

  const eligible = input.companies.filter(
    (c) =>
      !c.isDemo &&
      c.dataMode === "OPERATIONAL" &&
      c.isActive &&
      c.vatStatusKnown,
  );

  if (eligible.length === 0) {
    return {
      alternatives: [],
      reasoning: ["No operational companies with known VAT status"],
      blockers: ["No eligible real company"],
      relatedCompanyRisk: false,
    };
  }

  const ranked = [...eligible].sort(
    (a, b) => commodityFit(b, input.rfq) - commodityFit(a, input.rfq),
  );
  const best = ranked[0]!;
  const alternatives = ranked.slice(1, 3).map((c) => c.id);

  reasoning.push(`Recommended ${best.legalName} by commodity/location/readiness/Gmail fit`);
  if (best.readinessOverall !== "READY") {
    blockers.push(...best.readinessBlockers);
    reasoning.push(`Readiness ${best.readinessOverall}`);
  }
  if (!best.hasMappedGmail) {
    blockers.push("Recommended company has no mapped Gmail yet");
  }
  if (!best.outboundSourcingEnabled) {
    blockers.push("Recommended company outbound sourcing disabled");
  }

  const relatedCompanyRisk = ranked.some(
    (c) =>
      c.id !== best.id &&
      c.relatedCompanyGroupId &&
      c.relatedCompanyGroupId === best.relatedCompanyGroupId,
  );
  if (relatedCompanyRisk) {
    reasoning.push(
      "Related-company competition risk — do not auto-bid multiple related companies on same opportunity",
    );
  }

  return {
    recommendedCompanyId: best.id,
    alternatives,
    reasoning,
    blockers,
    relatedCompanyRisk,
  };
}
