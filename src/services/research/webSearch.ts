/**
 * Pluggable web search backends for live product discovery.
 */

import type { HttpClient } from "./httpClient";
import { classifySource } from "@/domain/sourceClassification";

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  sourceQuality: number;
  sourceType: string;
};

export interface WebSearchBackend {
  readonly id: string;
  search(query: string, maxResults: number): Promise<SearchHit[]>;
}

/**
 * DuckDuckGo HTML endpoint — no API key required.
 */
export class DuckDuckGoHtmlSearch implements WebSearchBackend {
  readonly id = "duckduckgo-html";

  constructor(private readonly http: HttpClient) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await this.http.get(url);
    if (!res.ok) return [];
    return parseDuckDuckGoHtml(res.body, maxResults);
  }
}

export class FixtureWebSearch implements WebSearchBackend {
  readonly id = "fixture-search";

  constructor(private readonly byQuery: Record<string, SearchHit[]>) {}

  async search(query: string, maxResults: number): Promise<SearchHit[]> {
    const key =
      Object.keys(this.byQuery).find((k) =>
        query.toLowerCase().includes(k.toLowerCase()),
      ) ?? "*";
    return (this.byQuery[key] ?? this.byQuery["*"] ?? []).slice(0, maxResults);
  }
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = [];
  // result__a links + optional snippet
  const re =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && hits.length < maxResults) {
    const rawHref = decodeXml(m[1]);
    const title = stripTags(m[2]);
    const url = unwrapDuckDuckGoRedirect(rawHref);
    if (!url.startsWith("http")) continue;
    if (/duckduckgo\.com|youtube\.com|facebook\.com|linkedin\.com/i.test(url)) {
      continue;
    }
    const classified = classifySource(url);
    hits.push({
      title,
      url,
      snippet: "",
      domain: classified.domain,
      sourceQuality: classified.qualityScore,
      sourceType: classified.sourceType,
    });
  }

  // Snippets
  const snippets = [
    ...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi),
  ].map((x) => stripTags(x[1]));
  for (let i = 0; i < hits.length && i < snippets.length; i++) {
    hits[i].snippet = snippets[i];
  }

  // Prefer SA commercial domains in ordering without discarding others
  hits.sort((a, b) => {
    const aSa = a.domain.endsWith(".co.za") || a.domain.includes("takealot") ? 1 : 0;
    const bSa = b.domain.endsWith(".co.za") || b.domain.includes("takealot") ? 1 : 0;
    if (bSa !== aSa) return bSa - aSa;
    return b.sourceQuality - a.sourceQuality;
  });

  return hits.slice(0, maxResults);
}

function unwrapDuckDuckGoRedirect(href: string): string {
  try {
    if (href.includes("uddg=")) {
      const u = new URL(href, "https://duckduckgo.com");
      const target = u.searchParams.get("uddg");
      if (target) return decodeURIComponent(target);
    }
    return href;
  } catch {
    return href;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}
