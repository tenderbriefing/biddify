/**
 * LiveWebResearchProvider — public web product research for unfamiliar RFQs.
 */

import {
  type ProductResearchProvider,
  type ResearchCandidate,
  type ResearchQuery,
} from "@/domain/productResearch";
import {
  generateProductSearchQueries,
  type GeneratedSearchQuery,
} from "@/domain/searchQueryGeneration";
import { RESEARCH_POLICY } from "@/domain/researchPolicy";
import {
  ageDaysFromRetrieved,
  freshnessBand,
  isUsableForAutonomousPricing,
} from "@/domain/researchPolicy";
import { interpretBrandRequirement } from "@/domain/brandRules";
import type { HttpClient } from "./httpClient";
import {
  BudgetedHttpClient,
  FetchHttpClient,
} from "./httpClient";
import {
  DuckDuckGoHtmlSearch,
  type SearchHit,
  type WebSearchBackend,
} from "./webSearch";
import {
  CompositeWebSearch,
  TakealotCatalogSearch,
  type TakealotProductHit,
} from "./takealotCatalog";
import { inspectProductPage, type InspectedProductPage } from "./pageInspector";
import { ResearchCache } from "./researchCache";
import { normalizePackPurchase, parsePackSize } from "@/domain/packNormalization";
import { extractUsablePrice } from "@/domain/priceExtraction";
import { extractDeliveryFromText } from "@/domain/deliveryEvidence";
import {
  classifySource,
  evidenceLevelForSource,
} from "@/domain/sourceClassification";
import { sanitizeWebContent } from "@/domain/webContentSafety";

export type LiveResearchEvent =
  | { type: "LIVE_RESEARCH_STARTED"; lineNumber: number }
  | {
      type: "SEARCH_QUERY_GENERATED";
      lineNumber: number;
      query: GeneratedSearchQuery;
    }
  | {
      type: "PRODUCT_SOURCE_DISCOVERED";
      lineNumber: number;
      hit: SearchHit;
    }
  | {
      type: "PRODUCT_PAGE_INSPECTED";
      lineNumber: number;
      page: InspectedProductPage;
    }
  | {
      type: "PRODUCT_PRICE_OBSERVED";
      lineNumber: number;
      url: string;
      price: number | null;
      usable: boolean;
    }
  | {
      type: "PRODUCT_SPEC_OBSERVED";
      lineNumber: number;
      url: string;
      attributes: string[];
    }
  | {
      type: "PRODUCT_CANDIDATE_REJECTED";
      lineNumber: number;
      url: string;
      reason: string;
    }
  | {
      type: "LIVE_RESEARCH_COMPLETED";
      lineNumber: number;
      candidateCount: number;
      metrics: LiveLineMetrics;
    };

export type LiveLineMetrics = {
  queries: number;
  hits: number;
  pagesInspected: number;
  failures: string[];
  durationMs: number;
};

export type LiveWebResearchOptions = {
  http?: HttpClient;
  search?: WebSearchBackend;
  cache?: ResearchCache;
  onEvent?: (event: LiveResearchEvent) => void;
  now?: () => Date;
};

export class LiveWebResearchProvider implements ProductResearchProvider {
  readonly id = "live-web";
  private readonly http: BudgetedHttpClient;
  private readonly searchBackend: WebSearchBackend;
  private readonly cache: ResearchCache;
  private readonly onEvent?: (event: LiveResearchEvent) => void;
  private readonly now: () => Date;
  readonly metricsByLine = new Map<number, LiveLineMetrics>();

  constructor(opts: LiveWebResearchOptions = {}) {
    const inner = opts.http ?? new FetchHttpClient();
    this.http = new BudgetedHttpClient(inner);
    this.searchBackend =
      opts.search ??
      new CompositeWebSearch([
        new TakealotCatalogSearch(this.http),
        new DuckDuckGoHtmlSearch(this.http),
      ]);
    this.cache = opts.cache ?? new ResearchCache();
    this.onEvent = opts.onEvent;
    this.now = opts.now ?? (() => new Date());
  }

  get fetchCount() {
    return this.http.fetchCount;
  }

  async search(query: ResearchQuery): Promise<ResearchCandidate[]> {
    const started = Date.now();
    const failures: string[] = [];
    this.emit({ type: "LIVE_RESEARCH_STARTED", lineNumber: query.lineNumber });

    const brandRule = interpretBrandRequirement({
      description: query.description,
      brandRequirement: query.brandRequirement,
    });

    const queries = generateProductSearchQueries(
      {
        lineNumber: query.lineNumber,
        description: query.description,
        brandRequirement: brandRule.brand ?? query.brandRequirement,
        modelRequirement: query.modelRequirement,
        technicalSpecifications: query.technicalSpecifications,
      },
      RESEARCH_POLICY.budget.maxQueriesPerLine,
    );

    for (const q of queries) {
      this.emit({
        type: "SEARCH_QUERY_GENERATED",
        lineNumber: query.lineNumber,
        query: q,
      });
    }

    const hits: SearchHit[] = [];
    const seenUrls = new Set<string>();

    for (const q of queries) {
      try {
        const batch = await this.searchBackend.search(
          q.query,
          RESEARCH_POLICY.budget.maxSearchResultsPerQuery,
        );
        for (const hit of batch) {
          const key = hit.url.split("?")[0].toLowerCase();
          if (seenUrls.has(key)) continue;
          seenUrls.add(key);
          hits.push(hit);
          this.emit({
            type: "PRODUCT_SOURCE_DISCOVERED",
            lineNumber: query.lineNumber,
            hit,
          });
        }
      } catch (err) {
        failures.push(`SEARCH_FAILED:${q.query}`);
        void err;
      }
    }

    // Prefer higher quality SA sources for inspection order
    hits.sort((a, b) => b.sourceQuality - a.sourceQuality);

    const candidates: ResearchCandidate[] = [];
    let pagesInspected = 0;

    for (const hit of hits) {
      if (pagesInspected >= RESEARCH_POLICY.budget.maxPagesInspectedPerLine) {
        break;
      }

      const cacheKey = query.description;
      const cached = this.cache.get(cacheKey, hit.url, this.now());
      let page: InspectedProductPage;
      if (cached) {
        page = cached;
      } else {
        pagesInspected += 1;
        // Catalogue hits with embedded price: synthesize inspected evidence,
        // then optionally deepen via HTML page fetch when budget allows.
        const catalogHit = hit as TakealotProductHit;
        if (catalogHit.price != null && catalogHit.plid) {
          page = pageFromCatalogHit(catalogHit, this.now());
          // Still fetch public product page when possible for delivery/spec text
          const htmlPage = await inspectProductPage(this.http, hit.url);
          if (htmlPage.ok) {
            page = {
              ...page,
              description: htmlPage.description ?? page.description,
              attributes: [
                ...new Set([...page.attributes, ...htmlPage.attributes]),
              ],
              delivery:
                htmlPage.delivery.known || htmlPage.delivery.type !== "UNKNOWN_DELIVERY"
                  ? htmlPage.delivery
                  : page.delivery,
              availability: htmlPage.availability ?? page.availability,
              safetyFlags: [
                ...page.safetyFlags,
                ...htmlPage.safetyFlags,
                "CATALOGUE_PLUS_PAGE",
              ],
              rawTextExcerpt:
                htmlPage.rawTextExcerpt || page.rawTextExcerpt,
            };
          }
        } else {
          page = await inspectProductPage(this.http, hit.url);
        }
        if (page.ok) this.cache.set(cacheKey, page);
      }

      this.emit({
        type: "PRODUCT_PAGE_INSPECTED",
        lineNumber: query.lineNumber,
        page,
      });

      if (!page.ok) {
        failures.push(page.failure ?? "PAGE_FETCH_FAILED");
        this.emit({
          type: "PRODUCT_CANDIDATE_REJECTED",
          lineNumber: query.lineNumber,
          url: hit.url,
          reason: page.failure ?? "PAGE_FETCH_FAILED",
        });
        continue;
      }

      this.emit({
        type: "PRODUCT_SPEC_OBSERVED",
        lineNumber: query.lineNumber,
        url: page.finalUrl,
        attributes: page.attributes,
      });

      const usablePrice = page.price.normalizedUsablePrice;
      this.emit({
        type: "PRODUCT_PRICE_OBSERVED",
        lineNumber: query.lineNumber,
        url: page.finalUrl,
        price: usablePrice,
        usable: page.price.usableForAutonomousPricing,
      });

      if (!page.price.usableForAutonomousPricing || usablePrice == null) {
        this.emit({
          type: "PRODUCT_CANDIDATE_REJECTED",
          lineNumber: query.lineNumber,
          url: page.finalUrl,
          reason: page.price.priceType || "PRICE_NOT_FOUND",
        });
        // Still return as candidate with priceKnown=false for transparency
      }

      // Mandatory brand gate early
      if (
        brandRule.rule === "MANDATORY_BRAND" &&
        brandRule.brand &&
        !(
          (page.brand ?? "").toLowerCase().includes(brandRule.brand.toLowerCase()) ||
          (page.productName ?? "")
            .toLowerCase()
            .includes(brandRule.brand.toLowerCase())
        )
      ) {
        this.emit({
          type: "PRODUCT_CANDIDATE_REJECTED",
          lineNumber: query.lineNumber,
          url: page.finalUrl,
          reason: `MANDATORY_BRAND ${brandRule.brand} not observed`,
        });
        continue;
      }

      const pack = normalizePackPurchase({
        tenderQuantity: query.quantity,
        supplierPackSize: page.packSize,
        packPrice: page.packSize && page.packSize > 1 ? usablePrice : null,
        unitPrice: usablePrice,
      });

      const ageDays = ageDaysFromRetrieved(page.retrievedAt, this.now());
      const band = freshnessBand(ageDays);

      candidates.push({
        sourceName: page.sourceType + ":" + (classifyDomain(page.finalUrl) || hit.domain),
        sourceType: page.sourceType,
        productName: page.productName ?? hit.title,
        brand: page.brand,
        modelSku: page.modelSku,
        productUrl: page.finalUrl,
        price: usablePrice,
        priceKnown: Boolean(page.price.usableForAutonomousPricing && usablePrice != null),
        vatTreatment: page.price.vatTreatment,
        packSize: page.packSize,
        packUnit: query.unit,
        effectiveUnitCost: pack.effectiveCostPerTenderUnit,
        availability: page.availability,
        deliveryCost: page.delivery.known ? page.delivery.amount : null,
        deliveryKnown: page.delivery.known,
        evidenceLevel: page.evidenceLevel,
        retrievedAt: page.retrievedAt,
        evidenceAgeHours: ageDays * 24,
        rawEvidence: {
          provider: this.id,
          searchTitle: hit.title,
          searchSnippet: hit.snippet,
          sourceQuality: page.sourceQuality,
          priceType: page.price.priceType,
          priceNotes: page.price.normalizationNotes,
          priceRiskFlags: page.price.riskFlags,
          delivery: page.delivery,
          packCalculation: pack,
          freshnessBand: band,
          freshnessUsable: isUsableForAutonomousPricing(band),
          safetyFlags: page.safetyFlags,
          attributes: page.attributes,
          brandRule,
          failure: page.failure,
        },
      });
    }

    const metrics: LiveLineMetrics = {
      queries: queries.length,
      hits: hits.length,
      pagesInspected,
      failures,
      durationMs: Date.now() - started,
    };
    this.metricsByLine.set(query.lineNumber, metrics);
    this.emit({
      type: "LIVE_RESEARCH_COMPLETED",
      lineNumber: query.lineNumber,
      candidateCount: candidates.length,
      metrics,
    });

    return candidates;
  }

  private emit(event: LiveResearchEvent) {
    this.onEvent?.(event);
  }
}

function classifyDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function pageFromCatalogHit(
  hit: TakealotProductHit,
  retrievedAt: Date,
): InspectedProductPage {
  const classified = classifySource(hit.url);
  const title = hit.title;
  const packSize = parsePackSize(title);
  const price = extractUsablePrice({
    amount: hit.price ?? null,
    saleAmount:
      hit.listingPrice != null &&
      hit.price != null &&
      hit.listingPrice > hit.price
        ? hit.price
        : null,
    contextText: `${title} ${hit.snippet} including VAT South Africa`,
  });
  const delivery = extractDeliveryFromText(
    hit.shippingMessage ?? hit.snippet,
    hit.url,
  );
  // FREE NEXT DAY WITH TAKEALOTMORE is membership — treat as unknown unless free without membership
  const deliverySafe =
    /TAKEALOTMORE/i.test(hit.shippingMessage ?? "") &&
    delivery.type === "FREE_DELIVERY"
      ? {
          ...delivery,
          type: "UNKNOWN_DELIVERY" as const,
          amount: null,
          known: false,
          notes: [
            "Member/subscription free delivery — not treated as free for tender economics",
          ],
        }
      : delivery;

  sanitizeWebContent(title); // evidence-only path exercised

  return {
    url: hit.url,
    finalUrl: hit.url,
    ok: true,
    productName: title,
    brand: hit.brand ?? null,
    modelSku: hit.tsin != null ? String(hit.tsin) : null,
    description: hit.snippet,
    price,
    packSize,
    availability: "IN_STOCK",
    delivery: deliverySafe,
    attributes: extractAttrTokens(title),
    sourceType: classified.sourceType,
    sourceQuality: classified.qualityScore,
    evidenceLevel: evidenceLevelForSource(classified.sourceType),
    retrievedAt,
    safetyFlags: ["CATALOGUE_API_EVIDENCE"],
    rawTextExcerpt: `${title} ${hit.snippet}`.slice(0, 1500),
  };
}

function extractAttrTokens(text: string): string[] {
  const out: string[] = [];
  const re = /\b(\d+(?:\.\d+)?)\s*(ml|g|kg|mm|m|pack|v|volt)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(`${m[1]}${m[2].toLowerCase()}`);
  }
  if (/\baaa\b/i.test(text)) out.push("aaa");
  else if (/\baa\b/i.test(text)) out.push("aa");
  if (/alkaline/i.test(text)) out.push("alkaline");
  if (/1\.5\s*v/i.test(text)) out.push("1.5v");
  return [...new Set(out)];
}
