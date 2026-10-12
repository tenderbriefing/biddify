import { describe, expect, it } from "vitest";

/**
 * Quote parsing contract: missing commercial fields stay UNKNOWN.
 * Never coerce missing price → 0 or missing delivery → free.
 */
function normaliseQuoteFields(input: {
  unitCost?: number | null;
  deliveryCost?: number | null;
  vatIncluded?: boolean | null;
}) {
  return {
    unitCost: input.unitCost ?? null,
    priceKnown: input.unitCost != null && Number.isFinite(input.unitCost),
    deliveryCost: input.deliveryCost ?? null,
    deliveryKnown:
      input.deliveryCost != null && Number.isFinite(input.deliveryCost),
    vatIncluded: input.vatIncluded ?? null,
    vatKnown: input.vatIncluded === true || input.vatIncluded === false,
  };
}

describe("quote unknown-value contract", () => {
  it("keeps missing price as UNKNOWN not zero", () => {
    const q = normaliseQuoteFields({});
    expect(q.unitCost).toBeNull();
    expect(q.priceKnown).toBe(false);
  });

  it("keeps missing delivery as UNKNOWN not free", () => {
    const q = normaliseQuoteFields({ unitCost: 10 });
    expect(q.deliveryCost).toBeNull();
    expect(q.deliveryKnown).toBe(false);
  });

  it("keeps missing VAT status as UNKNOWN", () => {
    const q = normaliseQuoteFields({ unitCost: 10, deliveryCost: 50 });
    expect(q.vatIncluded).toBeNull();
    expect(q.vatKnown).toBe(false);
  });
});
