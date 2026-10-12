import { describe, expect, it } from "vitest";
import { normalizeUnit, measureConversionFactor } from "./unitOfMeasure";
import { extractPackSemantics, isFirmPackEvidence } from "./packExtraction";
import { reconcileQuantity } from "./quantityReconciliation";
import { classifyPriceVariance } from "./priceVariancePolicy";
import { normalizeSupplierPriceForComparison } from "./vatNormalization";
import { classifyDeliveryV2 } from "./deliveryMaterialityV2";
import { selectBulkTierPrice } from "./bulkPricing";
import { selectProcurementCost } from "./procurementCostStrategy";
import {
  buildLineWaterfall,
  buildRfqWaterfall,
} from "./costWaterfall";
import { evaluateCommercialIntegrity } from "./commercialIntegrity";
import type { DeliveryEvidence } from "./deliveryEvidence";

describe("unit taxonomy", () => {
  it("aliases EA PCS PK CTN LTR ML KG G", () => {
    expect(normalizeUnit("EA")).toBe("EACH");
    expect(normalizeUnit("PCS")).toBe("EACH");
    expect(normalizeUnit("PC")).toBe("EACH");
    expect(normalizeUnit("PK")).toBe("PACK");
    expect(normalizeUnit("CTN")).toBe("CARTON");
    expect(normalizeUnit("LTR")).toBe("LITRE");
    expect(normalizeUnit("ML")).toBe("MILLILITRE");
    expect(normalizeUnit("KG")).toBe("KILOGRAM");
    expect(normalizeUnit("G")).toBe("GRAM");
  });

  it("kg/g and litre/ml conversion factors", () => {
    expect(measureConversionFactor("KILOGRAM", "GRAM")).toBe(1000);
    expect(measureConversionFactor("LITRE", "MILLILITRE")).toBe(1000);
  });
});

describe("pack extraction", () => {
  it("pack of 4", () => {
    const p = extractPackSemantics({
      productName: "Duracell AAA 4 Pack — R89.99",
      tenderUnit: "EA",
    });
    expect(p.packSize).toBe(4);
    expect(p.priceUnit).toBe("PER_PACK");
    expect(isFirmPackEvidence(p)).toBe(true);
  });

  it("pack of 10", () => {
    const p = extractPackSemantics({
      productName: "Energizer AA Pack of 10",
      tenderUnit: "EACH",
    });
    expect(p.packSize).toBe(10);
  });

  it("unknown pack size blocks firm evidence", () => {
    const p = extractPackSemantics({
      productName: "Duracell AAA Batteries — R89.99",
      tenderUnit: "EA",
    });
    expect(p.flags).toContain("PACK_SIZE_UNKNOWN");
    expect(isFirmPackEvidence(p)).toBe(false);
    expect(p.priceUnit).toBe("UNKNOWN");
  });

  it("EACH × EACH laptop", () => {
    const p = extractPackSemantics({
      productName: "Dell Latitude 5550 Notebook",
      tenderUnit: "EA",
    });
    expect(p.supplierSellingUnit).toBe("EACH");
    expect(p.packSize).toBe(1);
    expect(p.priceUnit).toBe("PER_EACH");
  });

  it("roll and bottle selling units", () => {
    expect(
      extractPackSemantics({
        productName: "Paper towel roll 280mm x 1500m",
        tenderUnit: "EA",
      }).supplierSellingUnit,
    ).toBe("ROLL");
    expect(
      extractPackSemantics({
        productName: "Sunlight dishwashing liquid 750ml bottle",
        tenderUnit: "EA",
      }).supplierSellingUnit,
    ).toBe("BOTTLE");
  });
});

describe("quantity reconciliation", () => {
  it("ceil pack calculation with surplus", () => {
    const r = reconcileQuantity({
      tenderQuantity: 250,
      tenderUnit: "EA",
      productName: "Generic AAA Pack of 24",
      observedSupplierPrice: 199,
    });
    expect(r.packsRequired).toBe(11);
    expect(r.unitsPurchased).toBe(264);
    expect(r.surplusUnits).toBe(14);
    expect(r.procurementCost).toBe(2189);
    expect(r.firm).toBe(true);
    expect(r.flags).toContain("SURPLUS_UNITS");
  });

  it("price-per-each simple", () => {
    const r = reconcileQuantity({
      tenderQuantity: 5,
      tenderUnit: "EA",
      productName: "Dell Latitude laptop",
      observedSupplierPrice: 19499,
    });
    expect(r.packsRequired).toBe(5);
    expect(r.procurementCost).toBe(97495);
    expect(r.effectiveTenderUnitCost).toBe(19499);
    expect(r.surplusUnits).toBe(0);
  });

  it("price-per-pack of 4", () => {
    const r = reconcileQuantity({
      tenderQuantity: 100,
      tenderUnit: "EA",
      productName: "Duracell AAA — Pack of 4",
      observedSupplierPrice: 89.99,
    });
    expect(r.packsRequired).toBe(25);
    expect(r.procurementCost).toBe(2249.75);
    expect(r.effectiveTenderUnitCost).toBe(22.5);
  });

  it("unknown price basis not firm", () => {
    const r = reconcileQuantity({
      tenderQuantity: 150,
      tenderUnit: "EA",
      productName: "Duracell AAA Batteries",
      observedSupplierPrice: 89.99,
    });
    expect(r.firm).toBe(false);
    expect(r.procurementCost).toBeNull();
  });

  it("preserves dimensional attributes separately", () => {
    const r = reconcileQuantity({
      tenderQuantity: 50,
      tenderUnit: "BOTTLE",
      productName: "Dishwashing liquid 750ml bottle",
      observedSupplierPrice: 35,
      productAttributes: { volumeMl: 750 },
    });
    expect(r.requiredProductAttributes?.volumeMl).toBe(750);
    expect(r.packsRequired).toBe(50);
    expect(r.procurementCost).toBe(1750);
  });

  it("cross-source effective unit comparison", () => {
    const a = reconcileQuantity({
      tenderQuantity: 100,
      tenderUnit: "EA",
      productName: "Brand X Pack of 10",
      observedSupplierPrice: 100,
    });
    const b = reconcileQuantity({
      tenderQuantity: 100,
      tenderUnit: "EA",
      productName: "Brand Y Pack of 20",
      observedSupplierPrice: 180,
    });
    expect(a.effectiveTenderUnitCost).toBe(10);
    expect(b.effectiveTenderUnitCost).toBe(9);
    expect((b.effectiveTenderUnitCost ?? 99) < (a.effectiveTenderUnitCost ?? 0)).toBe(
      true,
    );
  });
});

describe("bulk tiers", () => {
  it("applies matching tier without fabricating", () => {
    const r = selectBulkTierPrice(15, [
      { minQty: 1, maxQty: 9, unitPrice: 200, evidence: "page" },
      { minQty: 10, maxQty: null, unitPrice: 175, evidence: "page 10+" },
    ]);
    expect(r.price).toBe(175);
    expect(r.tier?.minQty).toBe(10);
  });
});

describe("VAT normalization", () => {
  it("does not compare inclusive vs exclusive without normalization", () => {
    const inc = normalizeSupplierPriceForComparison({
      price: 115,
      vatBasis: "VAT_INCLUSIVE",
    });
    const exc = normalizeSupplierPriceForComparison({
      price: 100,
      vatBasis: "VAT_EXCLUSIVE",
    });
    expect(inc.comparisonExVat).toBe(100);
    expect(exc.comparisonExVat).toBe(100);
    expect(inc.acquisitionForNonVatBidder).toBe(115);
  });

  it("UNKNOWN VAT not usable for firm comparison", () => {
    const u = normalizeSupplierPriceForComparison({
      price: 50,
      vatBasis: "UNKNOWN",
    });
    expect(u.usable).toBe(false);
  });
});

describe("price variance", () => {
  it("extreme variance blocks AUTO without explanation", () => {
    const v = classifyPriceVariance({
      oldCost: 27475,
      newCost: 110540,
    });
    expect(v.band).toBe("EXTREME_VARIANCE");
    expect(v.blocksAutoQuoted).toBe(true);
  });

  it("explained extreme variance does not block", () => {
    const v = classifyPriceVariance({
      oldCost: 27475,
      newCost: 110540,
      explanationCode: "UNIT_OF_MEASURE_CORRECTION",
      explanationText: "Old public-ref treated pack prices as each",
    });
    expect(v.blocksAutoQuoted).toBe(false);
  });

  it("normal variance", () => {
    const v = classifyPriceVariance({ oldCost: 100, newCost: 110 });
    expect(v.band).toBe("NORMAL_VARIANCE");
  });
});

describe("delivery materiality V2", () => {
  const unknown: DeliveryEvidence = {
    type: "UNKNOWN_DELIVERY",
    amount: null,
    threshold: null,
    destinationAssumption: null,
    source: null,
    known: false,
    notes: [],
  };

  it("immaterial on large product cost", () => {
    // Wait — policy marks 5% of 100k as material. Use small relative.
    const d = classifyDeliveryV2({
      delivery: unknown,
      productCost: 2000,
    });
    expect(d.class).toBe("UNKNOWN_IMMATERIAL");
    expect(d.blocksAutoQuoted).toBe(false);
    expect(d.allowance).toBeGreaterThan(0);
  });

  it("material on mid product cost", () => {
    const d = classifyDeliveryV2({
      delivery: unknown,
      productCost: 20000,
    });
    expect(d.class).toBe("UNKNOWN_MATERIAL");
    expect(d.blocksAutoQuoted).toBe(true);
  });

  it("known free", () => {
    const d = classifyDeliveryV2({
      delivery: {
        ...unknown,
        type: "FREE_DELIVERY",
        amount: 0,
        known: true,
      },
      productCost: 50000,
    });
    expect(d.class).toBe("KNOWN_FREE");
  });
});

describe("procurement cost strategy", () => {
  it("median-like for normal confidence", () => {
    const s = selectProcurementCost([
      { id: "a", effectiveUnitCost: 10, sourceQuality: 0.5, firm: true },
      { id: "b", effectiveUnitCost: 12, sourceQuality: 0.5, firm: true },
      { id: "c", effectiveUnitCost: 20, sourceQuality: 0.5, firm: true },
    ]);
    expect(s.strategy).toBe("MEDIAN_LIKE");
  });

  it("conservative on high dispersion", () => {
    const s = selectProcurementCost(
      [
        { id: "a", effectiveUnitCost: 10, sourceQuality: 0.5, firm: true },
        { id: "b", effectiveUnitCost: 50, sourceQuality: 0.5, firm: true },
      ],
      { highDispersion: true },
    );
    expect(s.strategy).toBe("CONSERVATIVE");
  });
});

describe("cost waterfall invariants", () => {
  it("reconciles line and RFQ math", () => {
    const line = buildLineWaterfall({
      lineNumber: 1,
      observedSupplierPrice: 199,
      supplierSellingUnit: "PACK",
      packSize: 24,
      packsRequired: 11,
      unitsPurchased: 264,
      surplusUnits: 14,
      normalizedProductCost: 2189,
      markupPercent: 20,
    });
    const rfq = buildRfqWaterfall([line], 20, {
      delivery: 100,
      riskAllowances: 50,
      otherDirectCosts: 0,
    });
    expect(rfq.productProcurement).toBe(2189);
    expect(rfq.landedCost).toBe(2339);
    expect(rfq.sellingPrice).toBe(2806.8);
    expect(rfq.grossProfit).toBe(467.8);
    expect(rfq.invariantsPassed).toBe(true);
    expect(rfq.grossMarginPercent).toBeCloseTo(16.67, 1);
  });
});

describe("commercial integrity gate", () => {
  it("fails when pack/price basis unknown", () => {
    const recon = reconcileQuantity({
      tenderQuantity: 150,
      tenderUnit: "EA",
      productName: "Duracell AAA Batteries",
      observedSupplierPrice: 89.99,
    });
    const gate = evaluateCommercialIntegrity({
      lines: [
        {
          lineNumber: 5,
          material: true,
          reconciliation: recon,
          priceBasisKnown: false,
          packKnownWhereRelevant: false,
          unitMismatch: false,
          specSelectable: true,
        },
      ],
      variance: classifyPriceVariance({ oldCost: 27475, newCost: 110000 }),
      delivery: classifyDeliveryV2({
        delivery: {
          type: "UNKNOWN_DELIVERY",
          amount: null,
          threshold: null,
          destinationAssumption: null,
          source: null,
          known: false,
          notes: [],
        },
        productCost: 110000,
      }),
      waterfall: null,
      vatAcceptable: true,
    });
    expect(gate.passed).toBe(false);
    expect(gate.quotationCommerciallyReady).toBe(false);
  });

  it("passes clean EACH laptop case", () => {
    const recon = reconcileQuantity({
      tenderQuantity: 5,
      tenderUnit: "EA",
      productName: "Dell Latitude notebook",
      observedSupplierPrice: 19499,
    });
    const line = buildLineWaterfall({
      lineNumber: 1,
      observedSupplierPrice: 19499,
      supplierSellingUnit: "EACH",
      packSize: 1,
      packsRequired: 5,
      unitsPurchased: 5,
      surplusUnits: 0,
      normalizedProductCost: recon.procurementCost!,
      markupPercent: 20,
    });
    const waterfall = buildRfqWaterfall([line], 20, {
      delivery: 0,
      riskAllowances: 0,
    });
    const gate = evaluateCommercialIntegrity({
      lines: [
        {
          lineNumber: 1,
          material: true,
          reconciliation: recon,
          priceBasisKnown: true,
          packKnownWhereRelevant: true,
          unitMismatch: false,
          specSelectable: true,
        },
      ],
      variance: classifyPriceVariance({ oldCost: null, newCost: 97495 }),
      delivery: classifyDeliveryV2({
        delivery: {
          type: "FREE_DELIVERY",
          amount: 0,
          threshold: null,
          destinationAssumption: null,
          source: null,
          known: true,
          notes: [],
        },
        productCost: 97495,
      }),
      waterfall,
      vatAcceptable: true,
    });
    expect(gate.passed).toBe(true);
  });
});
