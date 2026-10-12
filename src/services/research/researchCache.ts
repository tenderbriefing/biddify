/**
 * In-memory / injectable research cache.
 * Never bypasses freshness requirements.
 */

import {
  ageDaysFromRetrieved,
  freshnessBand,
  isUsableForAutonomousPricing,
} from "@/domain/researchPolicy";
import type { InspectedProductPage } from "./pageInspector";

export type CacheEntry = {
  key: string;
  page: InspectedProductPage;
  storedAt: Date;
};

export class ResearchCache {
  private readonly map = new Map<string, CacheEntry>();

  static key(normalizedSpec: string, sourceUrl: string): string {
    return `${normalizedSpec.trim().toLowerCase()}::${sourceUrl.trim().toLowerCase()}`;
  }

  get(
    normalizedSpec: string,
    sourceUrl: string,
    now: Date = new Date(),
  ): InspectedProductPage | null {
    const key = ResearchCache.key(normalizedSpec, sourceUrl);
    const entry = this.map.get(key);
    if (!entry) return null;
    const band = freshnessBand(ageDaysFromRetrieved(entry.page.retrievedAt, now));
    if (!isUsableForAutonomousPricing(band)) {
      this.map.delete(key);
      return null;
    }
    return entry.page;
  }

  set(normalizedSpec: string, page: InspectedProductPage): void {
    const key = ResearchCache.key(normalizedSpec, page.finalUrl || page.url);
    this.map.set(key, { key, page, storedAt: new Date() });
  }

  clear(): void {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }
}
