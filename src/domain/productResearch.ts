/**
 * Product research abstraction.
 * Providers are pluggable — V1 includes an EvidenceCatalogueProvider that
 * only surfaces prices already captured (no fabrication).
 */

import {
  mapLegacyQuoteEvidence,
  type PricingEvidenceLevel,
} from "./pricingEvidenceHierarchy";
import { toNumber } from "./money";

export type ResearchQuery = {
  lineNumber: number;
  description: string;
  brandRequirement?: string | null;
  modelRequirement?: string | null;
  quantity: number;
  unit: string;
  technicalSpecifications?: string[];
};

export type ResearchCandidate = {
  sourceName: string;
  sourceType: string;
  productName: string;
  brand?: string | null;
  modelSku?: string | null;
  productUrl?: string | null;
  price: number | null;
  priceKnown: boolean;
  vatTreatment?: string | null;
  packSize?: number | null;
  packUnit?: string | null;
  effectiveUnitCost: number | null;
  availability?: string | null;
  deliveryCost?: number | null;
  deliveryKnown: boolean;
  evidenceLevel: PricingEvidenceLevel;
  retrievedAt: Date;
  evidenceAgeHours: number | null;
  rawEvidence: Record<string, unknown>;
};

export interface ProductResearchProvider {
  readonly id: string;
  search(query: ResearchQuery): Promise<ResearchCandidate[]>;
}

export type LegacyQuoteLineEvidence = {
  supplierName: string;
  evidenceType: string;
  description: string;
  brandOffered?: string | null;
  modelOffered?: string | null;
  sku?: string | null;
  unitCost: number | null;
  priceKnown: boolean;
  quantity: number;
  unit?: string | null;
  availability?: string | null;
  sourceReference?: string | null;
  sourceDocumentPath?: string | null;
  quoteDate?: Date | null;
  receivedAt?: Date | null;
  deliveryCost?: number | null;
  deliveryKnown?: boolean;
  vatIncluded?: boolean | null;
  lineNumber?: number | null;
  rfqLineItemId?: string | null;
};

/**
 * Uses already-captured quote / public price rows as research candidates.
 * Does NOT invent prices.
 */
export class EvidenceCatalogueProvider implements ProductResearchProvider {
  readonly id = "evidence-catalogue";

  constructor(
    private readonly evidence: LegacyQuoteLineEvidence[],
    private readonly now: Date = new Date(),
  ) {}

  async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
    const out: ResearchCandidate[] = [];
    for (const e of this.evidence) {
      if (
        e.lineNumber != null &&
        e.lineNumber !== query.lineNumber &&
        e.rfqLineItemId == null
      ) {
        // Prefer explicit line mapping when present; otherwise fuzzy match
      }

      const descOverlap = tokenOverlap(query.description, e.description);
      const lineMatch =
        e.lineNumber === query.lineNumber ||
        (e.lineNumber == null && descOverlap >= 0.35);

      if (!lineMatch && descOverlap < 0.45) continue;

      const retrievedAt = e.quoteDate ?? e.receivedAt ?? this.now;
      const ageHours =
        (this.now.getTime() - retrievedAt.getTime()) / (1000 * 60 * 60);

      const price = e.priceKnown && e.unitCost != null ? toNumber(e.unitCost) : null;
      const level = mapLegacyQuoteEvidence(e.evidenceType, e.supplierName);

      out.push({
        sourceName: e.supplierName,
        sourceType: "captured_evidence",
        productName: e.description,
        brand: e.brandOffered,
        modelSku: e.modelOffered ?? e.sku,
        productUrl: e.sourceReference?.startsWith("http")
          ? e.sourceReference
          : null,
        price,
        priceKnown: Boolean(e.priceKnown && price != null),
        vatTreatment:
          e.vatIncluded === true
            ? "INCLUDED"
            : e.vatIncluded === false
              ? "EXCLUDED"
              : "UNKNOWN",
        packSize: null,
        packUnit: e.unit,
        effectiveUnitCost: price,
        availability: e.availability ?? null,
        deliveryCost: e.deliveryKnown ? toNumber(e.deliveryCost ?? 0) : null,
        deliveryKnown: e.deliveryKnown === true,
        evidenceLevel: level,
        retrievedAt,
        evidenceAgeHours: ageHours,
        rawEvidence: {
          evidenceType: e.evidenceType,
          sourceDocumentPath: e.sourceDocumentPath,
          sourceReference: e.sourceReference,
          provider: this.id,
        },
      });
    }
    return out;
  }
}

export class CompositeProductResearchProvider implements ProductResearchProvider {
  readonly id = "composite";

  constructor(private readonly providers: ProductResearchProvider[]) {}

  async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
    const batches = await Promise.all(
      this.providers.map((p) => p.search(query)),
    );
    return batches.flat();
  }
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2),
  );
  const tb = b
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
  if (ta.size === 0) return 0;
  const hits = tb.filter((t) => ta.has(t)).length;
  return hits / ta.size;
}
