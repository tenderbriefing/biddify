/**
 * South African retailer catalogue search via Takealot public JSON API.
 * Pluggable behind WebSearchBackend — not hard-coded into the worker.
 */

import type { HttpClient } from "./httpClient";
import type { SearchHit, WebSearchBackend } from "./webSearch";
import { classifySource } from "@/domain/sourceClassification";
import { RESEARCH_POLICY } from "@/domain/researchPolicy";

export type TakealotProductHit = SearchHit & {
  brand?: string;
  price?: number;
  packHint?: string;
  listingPrice?: number | null;
  tsin?: number;
  plid?: number;
  shippingMessage?: string;
};

export class TakealotCatalogSearch implements WebSearchBackend {
  readonly id = "takealot-catalog";

  constructor(private readonly http: HttpClient) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    // Strip OR-heavy query syntax — catalogue prefers plain terms
    const q = query
      .replace(/\bOR\b/gi, " ")
      .replace(/South Africa/gi, " ")
      .replace(/\bprice\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

    const api =
      `https://api.takealot.com/rest/v-1-13-0/searches/products,product_count?qsearch=` +
      `${encodeURIComponent(q)}&page_num=1`;

    const res = await this.http.get(api, {
      timeoutMs: RESEARCH_POLICY.budget.fetchTimeoutMs,
    });
    if (!res.ok || !res.body) return [];

    try {
      const json = JSON.parse(res.body) as {
        sections?: {
          products?: {
            results?: Array<{
              product_views?: {
                core?: {
                  id?: number;
                  title?: string;
                  slug?: string;
                  brand?: string;
                };
                buybox_summary?: {
                  prices?: number[];
                  listing_price?: number | null;
                  pretty_price?: string;
                  shipping_message?: { values?: Array<{ value?: string }> };
                  tsin?: number;
                };
                stock_availability_summary?: { status?: string };
              };
            }>;
          };
        };
      };

      const results = json.sections?.products?.results ?? [];
      const hits: TakealotProductHit[] = [];

      for (const row of results) {
        const pv = row.product_views;
        const core = pv?.core;
        if (!core?.id || !core.slug || !core.title) continue;
        const buy = pv?.buybox_summary;
        const price = buy?.prices?.[0] ?? null;
        const url = `https://www.takealot.com/${core.slug}/PLID${core.id}`;
        const classified = classifySource(url);
        const shipping = (buy?.shipping_message?.values ?? [])
          .map((v) => v.value)
          .filter(Boolean)
          .join(" ");

        hits.push({
          title: core.title,
          url,
          snippet: [
            core.brand,
            price != null ? `R${price}` : null,
            shipping,
          ]
            .filter(Boolean)
            .join(" · "),
          domain: classified.domain,
          sourceQuality: classified.qualityScore,
          sourceType: classified.sourceType,
          brand: core.brand,
          price: price ?? undefined,
          listingPrice: buy?.listing_price ?? null,
          packHint: core.title,
          tsin: buy?.tsin,
          plid: core.id,
          shippingMessage: shipping,
        });
        if (hits.length >= maxResults) break;
      }
      return hits;
    } catch {
      return [];
    }
  }
}

/**
 * Composite search: try catalogue APIs first, then HTML search backends.
 */
export class CompositeWebSearch implements WebSearchBackend {
  readonly id = "composite-search";

  constructor(private readonly backends: WebSearchBackend[]) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    for (const backend of this.backends) {
      try {
        const batch = await backend.search(query, maxResults);
        for (const hit of batch) {
          const key = hit.url.split("?")[0].toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(hit);
          if (out.length >= maxResults) return out;
        }
      } catch {
        // isolate backend failures
      }
    }
    return out;
  }
}
