import { describe, expect, it } from "vitest";
import { assessSpecificationEquivalence } from "./specificationEquivalence";
import { assessStock } from "./stockAssessment";
import { assessSupplierCredibility } from "./supplierCredibility";
import {
  buildProcurementCandidate,
  optimizeLineProcurement,
} from "./procurementOptimizer";
import { optimizeProcurementStrategy } from "./procurementStrategy";
import { rankProcurementCandidates } from "./procurementRanking";
import {
  investigateExtremeVariance,
  reclassifyVarianceAfterInvestigation,
} from "./varianceInvestigation";
import { classifyPriceVariance } from "./priceVariancePolicy";
import { evaluateCommercialIntegrity } from "./commercialIntegrity";
import { reconcileQuantity } from "./quantityReconciliation";
import type { ProcurementCandidate } from "./procurementCandidate";
import type { DeliveryEvidence } from "./deliveryEvidence";

const freeDelivery: DeliveryEvidence = {
  type: "FREE_DELIVERY",
  amount: 0,
  threshold: null,
  destinationAssumption: "SA metro",
  source: "https://www.takealot.com/x",
  known: true,
  notes: [],
};

function baseCand(
  overrides: Partial<Parameters<typeof buildProcurementCandidate>[0]> & {
    id: string;
    productTitle: string;
    displayedPrice: number;
  },
): Parameters<typeof buildProcurementCandidate>[0] {
  return {
    supplier: "Takealot",
    sourceUrl: "https://www.takealot.com/product/PLID1",
    sourceType: "retail",
    brand: "Duracell",
    sku: null,
    priceKnown: true,
    vatTreatment: "VAT_INCLUSIVE",
    availability: "In stock",
    delivery: freeDelivery,
    sourceQuality: 0.85,
    ...overrides,
  };
}

const lineBase = {
  lineNumber: 5,
  description: "Size AAA Duracell battery",
  tenderQuantity: 100,
  tenderUnit: "EA",
  brandRequirement: "Duracell",
  equivalentAllowed: true,
};

describe("specification equivalence", () => {
  it("exact part number is EXACT and selectable", () => {
    const r = assessSpecificationEquivalence({
      requiredDescription: "Widget",
      requiredModel: "ABC-123",
      requiredPartNumber: "ABC-123",
      equivalentAllowed: false,
      candidateDescription: "Widget ABC-123",
      candidateModel: "ABC-123",
      candidatePartNumber: "ABC-123",
    });
    expect(r.classification).toBe("EXACT");
    expect(r.selectableForAutonomousProcurement).toBe(true);
    expect(r.partNumberExact).toBe(true);
  });

  it("partial / incompatible not selectable", () => {
    const partial = assessSpecificationEquivalence({
      requiredDescription: "Dell Latitude 5550 16GB 512GB",
      equivalentAllowed: true,
      candidateDescription: "Laptop bag for Dell",
    });
    expect(["PARTIAL", "AMBIGUOUS", "INCOMPATIBLE"]).toContain(
      partial.classification,
    );
    expect(partial.selectableForAutonomousProcurement).toBe(false);
  });

  it("rejects refurbished when tender does not allow used", () => {
    const r = assessSpecificationEquivalence({
      requiredDescription: "Dell Laptop Windows 11 Pro 16GB RAM 512GB SSD",
      equivalentAllowed: true,
      candidateDescription:
        'Dell Latitude 7290 12.5" (Refurb) 8GB RAM 256GB SSD',
    });
    expect(r.classification).toBe("INCOMPATIBLE");
    expect(r.selectableForAutonomousProcurement).toBe(false);
  });
});

describe("stock assessment", () => {
  it("out of stock cannot win", () => {
    const s = assessStock({ availabilityText: "Out of stock" });
    expect(s.class).toBe("OUT_OF_STOCK");
    expect(s.eligibleToWin).toBe(false);
  });

  it("limited stock caps supply", () => {
    const s = assessStock({ availabilityText: "Only 60 left in stock" });
    expect(s.class).toBe("LIMITED_STOCK");
    expect(s.maxSupplyUnits).toBe(60);
  });
});

describe("supplier credibility", () => {
  it("established retailer HIGH/MEDIUM", () => {
    const c = assessSupplierCredibility({
      sourceName: "Takealot",
      sourceUrl: "https://www.takealot.com/x",
      sourceQuality: 0.9,
    });
    expect(["HIGH", "MEDIUM"]).toContain(c.band);
    expect(c.autonomousEligible).toBe(true);
  });
});

describe("quantity optimization", () => {
  it("each / pack / surplus", () => {
    const each = reconcileQuantity({
      tenderQuantity: 5,
      tenderUnit: "EA",
      productName: "Dell laptop",
      observedSupplierPrice: 10000,
    });
    expect(each.packsRequired).toBe(5);
    expect(each.surplusUnits).toBe(0);

    const pack = reconcileQuantity({
      tenderQuantity: 100,
      tenderUnit: "EA",
      productName: "Duracell AAA Pack of 4",
      observedSupplierPrice: 80,
    });
    expect(pack.packsRequired).toBe(25);
    expect(pack.surplusUnits).toBe(0);

    const surplus = reconcileQuantity({
      tenderQuantity: 100,
      tenderUnit: "EA",
      productName: "Brand X Pack of 24",
      observedSupplierPrice: 200,
    });
    expect(surplus.packsRequired).toBe(5);
    expect(surplus.surplusUnits).toBe(20);
  });
});

describe("supplier comparison ranking", () => {
  it("cheaper ambiguous does not beat expensive firm", () => {
    const ambiguous = buildProcurementCandidate(
      baseCand({
        id: "cheap-amb",
        productTitle: "Duracell AAA Batteries", // no pack → not firm
        displayedPrice: 40,
      }),
      lineBase,
    );
    const firm = buildProcurementCandidate(
      baseCand({
        id: "firm",
        productTitle: "Duracell AAA Pack of 4",
        displayedPrice: 89.99,
      }),
      lineBase,
    );
    expect(ambiguous.commercialIntegrityFirm).toBe(false);
    expect(firm.commercialIntegrityFirm).toBe(true);

    const ranked = rankProcurementCandidates([ambiguous, firm]);
    const winner = ranked.find((r) => r.rank === 1);
    expect(winner?.candidate.id).toBe("firm");
    expect(ranked.find((r) => r.candidate.id === "cheap-amb")?.disqualified).toBeTruthy();
  });

  it("out-of-stock cheapest cannot win", () => {
    const oos = buildProcurementCandidate(
      baseCand({
        id: "oos",
        productTitle: "Duracell AAA Pack of 4",
        displayedPrice: 50,
        availability: "Out of stock",
      }),
      lineBase,
    );
    const ok = buildProcurementCandidate(
      baseCand({
        id: "ok",
        productTitle: "Duracell AAA Pack of 4",
        displayedPrice: 90,
        availability: "In stock",
      }),
      lineBase,
    );
    const ranked = rankProcurementCandidates([oos, ok]);
    expect(ranked.find((r) => r.rank === 1)?.candidate.id).toBe("ok");
  });

  it("VAT inclusive vs exclusive compared on normalized basis via landed product cost", () => {
    const inc = buildProcurementCandidate(
      baseCand({
        id: "inc",
        productTitle: "Duracell AAA Pack of 4",
        displayedPrice: 115,
        vatTreatment: "VAT_INCLUSIVE",
      }),
      { ...lineBase, tenderQuantity: 4 },
    );
    expect(inc.vatNormalized?.comparisonExVat).toBe(100);
  });
});

describe("split sourcing", () => {
  it("deterministic fixture: split beats single when limited cheap stock", () => {
    const make = (
      id: string,
      price: number,
      maxSupply: number | null,
      delivery: number,
    ): ProcurementCandidate => {
      const c = buildProcurementCandidate(
        baseCand({
          id,
          productTitle: "Industrial Widget Pack of 10",
          displayedPrice: price,
          availability:
            maxSupply != null
              ? `Only ${maxSupply} left in stock`
              : "In stock",
          delivery:
            delivery === 0
              ? freeDelivery
              : {
                  type: "FIXED_DELIVERY",
                  amount: delivery,
                  threshold: null,
                  destinationAssumption: "SA",
                  source: "https://www.takealot.com/y",
                  known: true,
                  notes: [],
                },
          sourceUrl: `https://www.takealot.com/${id}`,
        }),
        {
          lineNumber: 1,
          description: "Industrial Widget",
          tenderQuantity: 100,
          tenderUnit: "EA",
          equivalentAllowed: true,
        },
      );
      // Force EXACT selectable + firm for fixture
      c.specification = {
        ...c.specification,
        classification: "EXACT",
        selectableForAutonomousProcurement: true,
        compatibilityScore: 0.95,
        legacyVerdict: "EXACT_MATCH",
      };
      c.commercialIntegrityFirm = true;
      c.integrityFlags = c.integrityFlags.filter(
        (f) => f !== "CREDIBILITY_LOW_OR_UNKNOWN",
      );
      if (maxSupply != null) {
        c.stock = {
          class: "LIMITED_STOCK",
          availableQuantity: maxSupply,
          confidence: 0.8,
          evidence: `Only ${maxSupply}`,
          eligibleToWin: true,
          maxSupplyUnits: maxSupply,
        };
      }
      // Recompute landed with delivery
      c.deliveryAllocation = delivery;
      c.procurementSubtotal = c.procurementSubtotal ?? 0;
      c.landedProcurementCost =
        (c.procurementSubtotal ?? 0) + delivery;
      c.effectiveTenderUnitCost =
        c.landedProcurementCost / 100;
      return c;
    };

    // Pack of 10 @ R100/pack → for 100 units = 10 packs = R1000 product
    // Limited A: 60 units available, cheap; B: unlimited expensive
    const a = make("A", 100, 60, 50); // 10 packs would be full; limited 60
    // Adjust: effective cheap
    a.procurementSubtotal = 600; // 60 units worth
    a.landedProcurementCost = 650;
    a.effectiveTenderUnitCost = 6.5;
    a.displayedPrice = 100;
    a.packSize = 10;
    a.packsRequired = 10;

    const b = make("B", 125, null, 80);
    // Full 100 units as packs of 10 @ 125 = 10*125=1250 + 80
    b.procurementSubtotal = 1250;
    b.landedProcurementCost = 1330;
    b.effectiveTenderUnitCost = 13.3;
    b.packSize = 10;
    b.packsRequired = 10;
    b.displayedPrice = 125;

    const strategy = optimizeProcurementStrategy({
      tenderQuantity: 100,
      candidates: [a, b],
      splitAllowed: true,
    });

    expect(strategy.type).toBe("SPLIT_SUPPLIER");
    expect(strategy.allocations).toHaveLength(2);
    expect(strategy.allocations[0].unitsAllocated).toBe(60);
    expect(strategy.allocations[1].unitsAllocated).toBe(40);
    expect(strategy.totalLandedCost!).toBeLessThan(1330);
    // Separate deliveries included
    expect(
      strategy.allocations.reduce((s, x) => s + x.deliveryAllocation, 0),
    ).toBeGreaterThan(0);
  });
});

describe("variance investigation", () => {
  it("explainable pack variance resolves", () => {
    const v = classifyPriceVariance({ oldCost: 2000, newCost: 8000 });
    expect(v.band).toBe("EXTREME_VARIANCE");
    const inv = investigateExtremeVariance({
      variance: v,
      signals: [
        {
          code: "DIFFERENT_PACK_QUANTITY",
          evidence: "Old assumed EACH; live is Pack of 4 @ R89.99",
          confidence: 0.85,
        },
      ],
      additionalSearches: ["Duracell AAA pack of South Africa"],
      additionalCandidateIds: ["c2"],
    });
    expect(inv.resolved).toBe(true);
    const re = reclassifyVarianceAfterInvestigation(v, inv);
    expect(re.blocksAutoQuoted).toBe(false);
  });

  it("unexplained extreme remains blocking", () => {
    const v = classifyPriceVariance({ oldCost: 27475, newCost: 110540 });
    const inv = investigateExtremeVariance({
      variance: v,
      signals: [],
      additionalSearches: ["second source"],
      additionalCandidateIds: [],
    });
    expect(inv.resolved).toBe(false);
    expect(reclassifyVarianceAfterInvestigation(v, inv).blocksAutoQuoted).toBe(
      true,
    );
  });
});

describe("integrity cannot be circumvented", () => {
  it("optimizer still fails gate when pack unknown", () => {
    const result = optimizeLineProcurement({
      ...lineBase,
      candidates: [
        baseCand({
          id: "1",
          productTitle: "Duracell AAA Batteries",
          displayedPrice: 89.99,
        }),
      ],
    });
    expect(result.strategy.type).toBe("INSUFFICIENT_EVIDENCE");
    const recon = result.candidates[0].quantityReconciliation;
    const gate = evaluateCommercialIntegrity({
      lines: [
        {
          lineNumber: 5,
          material: true,
          reconciliation: recon,
          priceBasisKnown: false,
          packKnownWhereRelevant: false,
          unitMismatch: false,
          specSelectable: false,
        },
      ],
      variance: null,
      delivery: null,
      waterfall: null,
      vatAcceptable: true,
    });
    expect(gate.passed).toBe(false);
  });

  it("firm pack-of-4 optimizes", () => {
    const result = optimizeLineProcurement({
      ...lineBase,
      candidates: [
        baseCand({
          id: "1",
          productTitle: "Duracell AAA Alkaline Battery Pack of 4",
          displayedPrice: 89.99,
        }),
        baseCand({
          id: "2",
          productTitle: "Duracell AAA Alkaline Battery Pack of 8",
          displayedPrice: 160,
          sourceUrl: "https://www.takealot.com/b",
        }),
        baseCand({
          id: "3",
          productTitle: "Duracell AAA Alkaline Battery Pack of 10",
          displayedPrice: 190,
          sourceUrl: "https://www.makro.co.za/b",
          supplier: "Makro",
        }),
      ],
    });
    expect(result.metrics.commerciallyUsable).toBeGreaterThanOrEqual(1);
    expect(
      ["SINGLE_SUPPLIER", "SPLIT_SUPPLIER"].includes(result.strategy.type),
    ).toBe(true);
    expect(result.strategy.totalLandedCost).toBeGreaterThan(0);
  });
});
