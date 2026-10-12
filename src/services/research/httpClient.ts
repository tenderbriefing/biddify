/**
 * Pluggable HTTP client for live research.
 * Tests inject fixtures — production uses fetch with timeouts.
 */

import { RESEARCH_POLICY } from "@/domain/researchPolicy";

export type HttpResponse = {
  ok: boolean;
  status: number;
  url: string;
  finalUrl: string;
  body: string;
  error?: string;
};

export interface HttpClient {
  get(url: string, opts?: { timeoutMs?: number }): Promise<HttpResponse>;
}

export class FetchHttpClient implements HttpClient {
  async get(
    url: string,
    opts?: { timeoutMs?: number },
  ): Promise<HttpResponse> {
    const timeoutMs =
      opts?.timeoutMs ?? RESEARCH_POLICY.budget.fetchTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const isApi = /\/api\.|\/rest\/v-|format=json/i.test(url);
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BiddifyResearchBot/1.0; +internal procurement research)",
          Accept: isApi
            ? "application/json,text/plain,*/*"
            : "text/html,application/xhtml+xml",
          ...(isApi
            ? {
                Referer: "https://www.takealot.com/",
                Origin: "https://www.takealot.com",
              }
            : {}),
        },
      });
      const body = await res.text();
      return {
        ok: res.ok,
        status: res.status,
        url,
        finalUrl: res.url || url,
        body,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        url,
        finalUrl: url,
        body: "",
        error: message,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Fixture client for deterministic tests. */
export class FixtureHttpClient implements HttpClient {
  constructor(
    private readonly fixtures: Record<string, Partial<HttpResponse> & { body: string }>,
  ) {}

  async get(url: string): Promise<HttpResponse> {
    const key =
      Object.keys(this.fixtures).find((k) => url.includes(k) || k === url) ??
      url;
    const fix = this.fixtures[key] ?? this.fixtures["*"];
    if (!fix) {
      return {
        ok: false,
        status: 404,
        url,
        finalUrl: url,
        body: "",
        error: "PAGE_FETCH_FAILED",
      };
    }
    return {
      ok: fix.ok ?? true,
      status: fix.status ?? 200,
      url,
      finalUrl: fix.finalUrl ?? url,
      body: fix.body,
      error: fix.error,
    };
  }
}

export class BudgetedHttpClient implements HttpClient {
  private fetches = 0;

  constructor(
    private readonly inner: HttpClient,
    private readonly maxFetches: number = RESEARCH_POLICY.budget.perRfqMaxFetches,
  ) {}

  get fetchCount() {
    return this.fetches;
  }

  async get(url: string, opts?: { timeoutMs?: number }): Promise<HttpResponse> {
    if (this.fetches >= this.maxFetches) {
      return {
        ok: false,
        status: 0,
        url,
        finalUrl: url,
        body: "",
        error: "RESEARCH_BUDGET_EXCEEDED",
      };
    }
    this.fetches += 1;
    return this.inner.get(url, opts);
  }
}
