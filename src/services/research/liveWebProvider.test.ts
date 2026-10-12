import { describe, expect, it } from "vitest";
import { LiveWebResearchProvider } from "./liveWebProvider";
import { FixtureHttpClient } from "./httpClient";
import { FixtureWebSearch } from "./webSearch";
import { ResearchCache } from "./researchCache";
import type { TakealotProductHit } from "./takealotCatalog";

describe("LiveWebResearchProvider (fixture)", () => {
  it("searches, inspects pages, extracts price without live internet", async () => {
    const catalogHit: TakealotProductHit = {
      title: "Duracell AAA Alkaline Pack of 4",
      url: "https://www.takealot.com/duracell-aaa-alkaline-pack-of-4/PLID1",
      snippet: "Duracell AAA 1.5V R89.99",
      domain: "takealot.com",
      sourceQuality: 0.62,
      sourceType: "MARKETPLACE",
      brand: "Duracell",
      price: 89.99,
      plid: 1,
      packHint: "Pack of 4",
    };
    const search = new FixtureWebSearch({
      Duracell: [catalogHit],
      "*": [],
    });
    const http = new FixtureHttpClient({
      "takealot.com/duracell": {
        body: `
          <html><title>Duracell AAA Alkaline Pack of 4</title>
          <body>Brand: Duracell Size AAA 1.5V alkaline Pack of 4
          Price R89.99 including VAT In stock Delivery fee R99</body></html>
        `,
      },
    });
    const events: string[] = [];
    const provider = new LiveWebResearchProvider({
      http,
      search,
      cache: new ResearchCache(),
      onEvent: (e) => events.push(e.type),
    });

    const results = await provider.search({
      lineNumber: 5,
      description: "Size AAA Duracell battery",
      brandRequirement: "Duracell",
      quantity: 150,
      unit: "EA",
      technicalSpecifications: ["aaa", "1.5V"],
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].priceKnown).toBe(true);
    expect(results[0].productUrl).toContain("takealot.com");
    expect(events).toContain("SEARCH_QUERY_GENERATED");
    expect(events).toContain("PRODUCT_PAGE_INSPECTED");
    expect(events).toContain("LIVE_RESEARCH_COMPLETED");
  });

  it("respects research budget", async () => {
    const search = new FixtureWebSearch({
      "*": Array.from({ length: 20 }, (_, i) => ({
        title: `Item ${i}`,
        url: `https://www.takealot.com/item-${i}/PLID${i}`,
        snippet: "x",
        domain: "takealot.com",
        sourceQuality: 0.6,
        sourceType: "MARKETPLACE",
      })),
    });
    const http = new FixtureHttpClient({
      "*": {
        body: "<title>Item</title> Price R10 including VAT",
      },
    });
    const provider = new LiveWebResearchProvider({ http, search });
    await provider.search({
      lineNumber: 1,
      description: "DISHWASHING LIQUID 750ML",
      quantity: 60,
      unit: "EA",
    });
    expect(provider.fetchCount).toBeLessThanOrEqual(40);
  });
});
