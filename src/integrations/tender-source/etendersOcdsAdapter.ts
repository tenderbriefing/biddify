import { ETENDERS_OCDS_SOURCE } from "@/domain/sourceIdentity";
import type {
  ListOpportunitiesParams,
  SourceDocument,
  SourceOpportunity,
  TenderSourceAdapter,
} from "./types";

const DEFAULT_BASE =
  process.env.ETENDERS_OCDS_BASE_URL ??
  "https://ocds-api.etenders.gov.za/api/OCDSReleases";

type OcdsRelease = {
  ocid?: string;
  id?: string;
  date?: string;
  buyer?: { id?: string; name?: string };
  tender?: {
    id?: string | number;
    title?: string;
    description?: string;
    status?: string;
    procurementMethod?: string;
    procurementMethodDetails?: string;
    mainProcurementCategory?: string;
    additionalProcurementCategories?: string[];
    category?: string;
    province?: string;
    procuringEntity?: { id?: string; name?: string };
    tenderPeriod?: { startDate?: string; endDate?: string };
    briefingSession?: {
      date?: string;
      venue?: string;
      compulsory?: boolean;
      isSession?: boolean;
    };
    documents?: Array<{
      id?: string;
      title?: string;
      url?: string;
      format?: string;
      datePublished?: string;
    }>;
  };
};

type OcdsPackage = {
  releases?: OcdsRelease[];
  links?: { next?: string };
  publishedDate?: string;
};

/**
 * Public National Treasury OCDS adapter.
 * No API key required. Does not touch TenderBriefing production.
 */
export class EtendersOcdsAdapter implements TenderSourceAdapter {
  readonly name = ETENDERS_OCDS_SOURCE;

  constructor(private readonly baseUrl: string = DEFAULT_BASE) {}

  async listOpportunities(
    params: ListOpportunitiesParams,
  ): Promise<SourceOpportunity[]> {
    const pageSize = Math.min(params.pageSize ?? 50, 100);
    const maxPages = params.maxPages ?? 3;
    const out: SourceOpportunity[] = [];
    let url =
      `${this.baseUrl}?dateFrom=${encodeURIComponent(params.dateFrom)}` +
      `&dateTo=${encodeURIComponent(params.dateTo)}` +
      `&PageSize=${pageSize}`;

    for (let page = 0; page < maxPages && url; page += 1) {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(
          `OCDS list failed HTTP ${res.status}: ${await res.text()}`,
        );
      }
      const body = (await res.json()) as OcdsPackage;
      for (const release of body.releases ?? []) {
        const mapped = mapRelease(release, body.publishedDate);
        if (mapped) out.push(mapped);
      }
      url = body.links?.next ?? "";
    }

    return out;
  }

  async getOpportunity(
    sourceOpportunityId: string,
  ): Promise<SourceOpportunity | null> {
    // Single-release endpoint is unreliable (observed 500s). Filter from a short window list.
    // Callers with known dates should prefer listOpportunities.
    const today = new Date();
    const dateTo = ymd(today);
    const from = new Date(today.getTime() - 14 * 86400000);
    const dateFrom = ymd(from);
    const list = await this.listOpportunities({
      dateFrom,
      dateTo,
      pageSize: 100,
      maxPages: 5,
    });
    return (
      list.find((o) => o.sourceOpportunityId === sourceOpportunityId) ?? null
    );
  }

  async getDocuments(sourceOpportunityId: string): Promise<SourceDocument[]> {
    const opp = await this.getOpportunity(sourceOpportunityId);
    return opp?.documents ?? [];
  }
}

export function mapRelease(
  release: OcdsRelease,
  packagePublished?: string,
): SourceOpportunity | null {
  const tender = release.tender;
  const ocid = release.ocid?.trim();
  if (!ocid || !tender) return null;

  const tenderNumber = tender.id != null ? String(tender.id) : null;
  const buyer =
    release.buyer?.name ||
    tender.procuringEntity?.name ||
    "Unknown buyer";
  const briefing = tender.briefingSession;
  const briefingCompulsoryKnown =
    briefing != null && typeof briefing.compulsory === "boolean";

  const documents: SourceDocument[] = (tender.documents ?? [])
    .filter((d) => d.url)
    .map((d) => ({
      id: d.id,
      title: d.title || "Document",
      url: d.url!,
      format: d.format ?? null,
      datePublished: d.datePublished ?? null,
    }));

  const sourceUrl = tenderNumber
    ? `https://www.etenders.gov.za/Home/opportunity?id=${tenderNumber}`
    : documents[0]?.url ?? null;

  return {
    source: ETENDERS_OCDS_SOURCE,
    sourceOpportunityId: ocid,
    ocid,
    tenderNumber,
    title: tender.title || tenderNumber || ocid,
    description: tender.description ?? null,
    buyer,
    department: tender.procuringEntity?.name ?? release.buyer?.name ?? null,
    category: tender.category ?? tender.mainProcurementCategory ?? null,
    mainProcurementCategory: tender.mainProcurementCategory ?? null,
    procurementMethod:
      tender.procurementMethodDetails || tender.procurementMethod || null,
    province: tender.province ?? null,
    publicationDate: tender.tenderPeriod?.startDate ?? release.date ?? null,
    sourcePublishedAt: release.date ?? packagePublished ?? null,
    sourceLastModifiedAt: release.date ?? null,
    closingRaw: tender.tenderPeriod?.endDate ?? null,
    briefingDateRaw: briefing?.date ?? null,
    briefingCompulsory: briefingCompulsoryKnown ? Boolean(briefing?.compulsory) : null,
    briefingCompulsoryKnown,
    briefingVenue: briefing?.venue ?? null,
    sourceUrl,
    documents,
    raw: release,
  };
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
