/**
 * Phase 3 commercial proof for BID-000011 (Johannesburg Water Cydna Lab consumables).
 * - Retrieves source PDF
 * - Extracts/verifies line items
 * - Records real public suppliers + DRAFT_NOT_SENT enquiries
 * - Records PUBLIC_PRICE_REFERENCE / MANUAL_ESTIMATE evidence (NOT fabricated supplier quotes)
 * - Builds comparison + pricing + working capital + commercial gate
 *
 * Does NOT send email or submit bids.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { retrieveAndExtractDocument } from "../src/services/documents/ingest";
import { generateSupplierEnquiryDraft } from "../src/domain/supplierEnquiry";
import { evaluateSpecMatch } from "../src/domain/specMatch";
import { calculateAcquisitionCost } from "../src/domain/acquisitionCost";
import { calculatePricing } from "../src/domain/pricing";
import { calculateWorkingCapital } from "../src/domain/workingCapital";
import { evaluateCommercialGate } from "../src/domain/commercialGate";
import { determineNextAction } from "../src/domain/nextAction";
import { writeAuditEvent } from "../src/lib/audit";
import {
  buildComparisonRows,
  calculateSplitSourceGoodsCost,
} from "../src/domain/quoteComparison";

async function main() {
  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000011" },
    include: { documents: true },
  });
  if (!rfq) throw new Error("BID-000011 not found — run import:etenders first");

  console.log("Pilot RFQ:", rfq.internalId, rfq.title, rfq.buyer);

  // Suitability gate from document title/description (pre-check)
  const suitabilityNotes =
    "Ordinary consumables (dishwashing liquid, paper towel, cotton wool, AA/AAA batteries). Manufacturer datasheets mandatory. No specialised laboratory licensing detected in source PDF.";

  const company = await prisma.company.findFirst({
    where: { registrationNumber: "DEMO-REG-001" },
  });
  if (!company) throw new Error("DEMO company missing — run db:seed");

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      selectedCompanyId: company.id,
      status: "SOURCING",
    },
  });

  // 1) Document retrieve + extract
  const doc = rfq.documents[0];
  if (!doc) throw new Error("No source document on RFQ");
  const ingest = await retrieveAndExtractDocument(prisma, doc.id, {
    force: true,
    verifyLineItems: true,
  });
  console.log("Ingest:", ingest);

  // Suitability after extraction
  const lineItems = await prisma.rfqLineItem.findMany({
    where: { rfqId: rfq.id },
    orderBy: { lineNumber: "asc" },
  });
  if (lineItems.length === 0) {
    throw new Error("Extraction produced no line items — pilot blocked");
  }

  await writeAuditEvent({
    action: "LINE_ITEMS_VERIFIED",
    entityType: "Rfq",
    entityId: rfq.id,
    metadata: { count: lineItems.length, suitabilityNotes },
  });

  // 2) Real public suppliers (discovery evidence — no fabricated quotes from them)
  const supplierDefs = [
    {
      name: "Makro South Africa (Massmart)",
      website: "https://www.makro.co.za",
      supplierType: "wholesaler",
      categories: "Consumables, cleaning, batteries, paper products",
      brands: "Various house brands; Duracell often stocked",
      location: "National incl. Johannesburg",
      geographicCoverage: "South Africa",
      discoverySource: "PUBLIC_WEB — makro.co.za corporate site",
      evidenceUrl: "https://www.makro.co.za",
      email: "trade@makro.example.invalid",
      notes:
        "Public wholesale brand. Contact email placeholder INVALID — DRAFT only, never sent.",
    },
    {
      name: "Bidvest Waltons",
      website: "https://www.waltons.co.za",
      supplierType: "wholesaler",
      categories: "Office and facility consumables",
      brands: "Various",
      location: "Johannesburg / national",
      geographicCoverage: "South Africa",
      discoverySource: "PUBLIC_WEB — waltons.co.za",
      evidenceUrl: "https://www.waltons.co.za",
      email: "quotes@waltons.example.invalid",
      notes: "Public supplier directory presence. Enquiry DRAFT_NOT_SENT only.",
    },
    {
      name: "Duracell (brand / authorised channel — SA)",
      website: "https://www.duracell.com",
      supplierType: "OEM",
      categories: "Batteries",
      brands: "Duracell",
      location: "South Africa distribution",
      geographicCoverage: "South Africa",
      discoverySource: "PUBLIC_WEB — brand site / OEM",
      evidenceUrl: "https://www.duracell.com",
      email: "sa-trade@duracell.example.invalid",
      notes:
        "OEM/brand for AAA Duracell line. Authorisation not required as OEM letter — brand-specified item. No email sent.",
    },
  ];

  const suppliers = [];
  for (const def of supplierDefs) {
    let s = await prisma.supplier.findFirst({ where: { name: def.name } });
    if (!s) {
      s = await prisma.supplier.create({
        data: {
          ...def,
          verificationStatus: "UNVERIFIED",
          isDemo: false,
          isActive: true,
        },
      });
      await writeAuditEvent({
        action: "SUPPLIER_DISCOVERED",
        entityType: "Supplier",
        entityId: s.id,
        metadata: { discoverySource: def.discoverySource },
      });
    }
    suppliers.push(s);
  }

  // 3) Enquiry drafts DRAFT_NOT_SENT
  for (const supplier of suppliers) {
    const existing = await prisma.supplierEnquiry.findFirst({
      where: { rfqId: rfq.id, supplierId: supplier.id },
    });
    if (existing) continue;
    const draft = generateSupplierEnquiryDraft({
      rfqInternalId: rfq.internalId,
      tenderNumber: rfq.tenderNumber,
      buyer: rfq.buyer,
      deliveryDestination: "Cydna Lab",
      deliveryAddress: rfq.deliveryAddress,
      deliveryDeadline: "On or before RFQ closing / as confirmed in PO",
      supplierName: supplier.name,
      lines: lineItems.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        specification: l.specification,
        quantity: Number(l.quantity),
        unit: l.unit,
        brandRequirement: l.brandRequirement,
        equivalentAllowed: l.equivalentAllowed,
      })),
    });
    await prisma.supplierEnquiry.create({
      data: {
        rfqId: rfq.id,
        supplierId: supplier.id,
        subject: draft.subject,
        body: draft.body,
        deliveryState: "DRAFT_NOT_SENT",
        productsSummary: draft.productsSummary,
      },
    });
    await writeAuditEvent({
      action: "SUPPLIER_ENQUIRY_DRAFTED",
      entityType: "SupplierEnquiry",
      entityId: supplier.id,
      metadata: { rfqId: rfq.id, state: "DRAFT_NOT_SENT" },
    });
  }

  // 4) PUBLIC_PRICE_REFERENCE evidence (explicitly NOT supplier quotations)
  // Clear the previous phase-3 price rows for this RFQ to keep idempotent.
  await prisma.supplierQuote.deleteMany({
    where: {
      rfqId: rfq.id,
      evidenceType: { in: ["PUBLIC_PRICE_REFERENCE", "MANUAL_ESTIMATE"] },
    },
  });

  const makro = suppliers[0]!;
  // Approximate SA public retail/wholesale observation bands — labelled PUBLIC_PRICE_REFERENCE.
  function publicUnitPriceFor(description: string): number | null {
    const d = description.toLowerCase();
    if (/dishwash/i.test(d)) return 28.5;
    if (/towel\s+paper|paper\s+towel|280/i.test(d)) return 210.0;
    if (/cotton\s+wool/i.test(d)) return 55.0;
    if (/\baaa\b/i.test(d) && /duracell/i.test(d)) return 14.9;
    if (/\baa\b/i.test(d) && /battery|penlight/i.test(d)) return 9.5;
    if (/\baaa\b/i.test(d)) return 14.9;
    return null;
  }

  const publicQuote = await prisma.supplierQuote.create({
    data: {
      rfqId: rfq.id,
      supplierId: makro.id,
      quoteReference: "PUBLIC-REF-CYDNA-2026-10",
      quoteDate: new Date(),
      currency: "ZAR",
      deliveryCost: null,
      deliveryKnown: false,
      leadTimeDays: 5,
      paymentTerms: "UNKNOWN (public reference — not a quote)",
      vatIncluded: true,
      vatKnown: true,
      evidenceType: "PUBLIC_PRICE_REFERENCE",
      verificationState: "UNVERIFIED",
      isComplete: false,
      notes:
        "PUBLIC_PRICE_REFERENCE only. Approximate SA market observation for commercial-engine validation. NOT a supplier quotation. Do not submit bids on this basis.",
      lineItems: {
        create: lineItems.map((l) => {
          const unitCost = publicUnitPriceFor(l.description);
          const qty = Number(l.quantity);
          const match = evaluateSpecMatch({
            rfqDescription: l.description,
            rfqBrand: l.brandRequirement,
            equivalentAllowed: l.equivalentAllowed,
            offeredDescription: l.description,
            offeredBrand: l.brandRequirement ?? "Generic / house brand",
          });
          return {
            rfqLineItemId: l.id,
            description: `Public ref — ${l.description}`,
            quantity: qty,
            unitCost,
            priceKnown: unitCost != null,
            lineTotal: unitCost != null ? unitCost * qty : null,
            brandOffered: l.brandRequirement ?? "UNSPECIFIED PUBLIC REF",
            matchState: match,
            mappingConfidence: 0.55,
            mappingNotes:
              "Mapped by RFQ line number for pilot mechanics — verify before any real bid",
            availability: "UNKNOWN",
            leadTimeDays: 5,
            notes: "PUBLIC_PRICE_REFERENCE",
          };
        }),
      },
    },
    include: { lineItems: true },
  });

  // Manual logistics estimate (separate evidence)
  const logistics = await prisma.supplierQuote.create({
    data: {
      rfqId: rfq.id,
      supplierId: makro.id,
      quoteReference: "MANUAL-LOGISTICS-JHB",
      quoteDate: new Date(),
      evidenceType: "MANUAL_ESTIMATE",
      verificationState: "UNVERIFIED",
      deliveryCost: 850,
      deliveryKnown: true,
      vatIncluded: false,
      vatKnown: true,
      paymentTerms: "N/A",
      notes:
        "MANUAL_ESTIMATE for Johannesburg metro delivery/collection to Cydna Lab area. Not a carrier quote.",
      isComplete: true,
      lineItems: {
        create: [
          {
            description: "Manual logistics estimate — JHB delivery",
            quantity: 1,
            unitCost: 850,
            priceKnown: true,
            lineTotal: 850,
            matchState: "UNKNOWN",
            notes: "MANUAL_ESTIMATE logistics only",
          },
        ],
      },
    },
  });

  await writeAuditEvent({
    action: "QUOTE_RECORDED",
    entityType: "SupplierQuote",
    entityId: publicQuote.id,
    metadata: {
      evidenceType: "PUBLIC_PRICE_REFERENCE",
      logisticsId: logistics.id,
    },
  });

  // 5) Comparison + split source (single supplier for pilot)
  const comparison = buildComparisonRows(
    lineItems.map((l) => ({
      rfqLineItemId: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      specification: l.specification,
      offers: publicQuote.lineItems
        .filter((ql) => ql.rfqLineItemId === l.id)
        .map((ql) => ({
          supplierId: makro.id,
          supplierName: makro.name,
          unitCost: ql.unitCost != null ? Number(ql.unitCost) : null,
          lineTotal: ql.lineTotal != null ? Number(ql.lineTotal) : null,
          deliveryCost: null,
          deliveryKnown: false,
          leadTimeDays: ql.leadTimeDays,
          matchState: ql.matchState,
          evidenceType: "PUBLIC_PRICE_REFERENCE",
          quoteLineId: ql.id,
        })),
    })),
  );

  const goodsSelections = lineItems.map((l) => {
    const offer = publicQuote.lineItems.find((ql) => ql.rfqLineItemId === l.id);
    return {
      quantity: Number(l.quantity),
      unitCost: offer?.unitCost != null ? Number(offer.unitCost) : null,
    };
  });
  const goodsCost = calculateSplitSourceGoodsCost(goodsSelections);
  if (goodsCost == null) throw new Error("Goods cost has UNKNOWN prices");

  // 6) Acquisition cost for NON-VAT company + VAT-inclusive public refs
  const acquisition = calculateAcquisitionCost({
    supplierGoodsAmount: goodsCost,
    supplierVatIncluded: true,
    biddingCompanyVatRegistered: company.vatRegistered,
  });

  const deliveryCost = 850;
  const contingency = Math.round(acquisition.acquisitionCost * 0.02 * 100) / 100;

  const pricing = calculatePricing({
    supplierCost: acquisition.acquisitionCost,
    delivery: deliveryCost,
    logistics: 0,
    contingency,
    markupPercent: 20,
    vatRegistered: company.vatRegistered,
    workingCapitalRequired: acquisition.acquisitionCost + deliveryCost,
  });

  const wc = calculateWorkingCapital({
    upfrontSupplierCash: acquisition.acquisitionCost + deliveryCost,
    expectedRecoveryDays: 30,
    supplierPaymentTerms: "Assumed COD / upfront (public ref — unconfirmed)",
    buyerPaymentTerms: "Assumed 30 days after delivery (JW typical — unconfirmed in extract)",
    financingAssumption:
      "No facility modelled; full acquisition + delivery cash before recovery",
  });

  const gate = evaluateCommercialGate({
    specificationsClear: true,
    lineItemsVerified: true,
    supplierIdentified: true,
    hasSupplierQuote: false,
    hasPriceEvidence: true,
    bestEvidenceType: "PUBLIC_PRICE_REFERENCE",
    productsCompliant: "UNKNOWN",
    deliveryFeasible: "UNKNOWN",
    complianceFeasible: "UNKNOWN",
    workingCapitalIntensity: wc.intensity,
    grossProfit: pricing.grossProfit,
    grossMarginPercent: pricing.grossMarginPercent,
    oemRequired: false,
    allPricesKnown: true,
    deliveryCostKnown: true,
  });

  // Clear prior selected scenarios for this RFQ pilot
  await prisma.pricingScenario.updateMany({
    where: { rfqId: rfq.id },
    data: { isSelected: false },
  });

  const scenario = await prisma.pricingScenario.create({
    data: {
      rfqId: rfq.id,
      name: "Phase3 public-ref 20% markup",
      markupPercent: pricing.markupPercent,
      supplierCostTotal: acquisition.netGoodsCost,
      supplierInputVatCost: acquisition.irrecoverableInputVat,
      deliveryCost,
      contingencyCost: contingency,
      landedCost: pricing.landedCost,
      sellingPriceExVat: pricing.sellingPriceExVat,
      vatAmount: pricing.vatAmount,
      totalQuotation: pricing.totalQuotation,
      grossProfit: pricing.grossProfit,
      grossMarginPercent: pricing.grossMarginPercent,
      workingCapitalRequired: wc.upfrontCashRequired,
      upfrontCashRequired: wc.upfrontCashRequired,
      expectedRecoveryDays: wc.expectedRecoveryDays,
      supplierPaymentTerms: wc.supplierPaymentTerms,
      buyerPaymentTerms: wc.buyerPaymentTerms,
      financingAssumption: wc.financingAssumption,
      evidenceQuality: "PUBLIC_PRICE_REFERENCE + MANUAL_ESTIMATE logistics",
      profitabilityGate: gate.gate,
      profitabilityReasons: JSON.stringify(gate.reasons),
      vatRegisteredSnapshot: company.vatRegistered,
      isSelected: true,
      isDemo: false,
      notes: [
        suitabilityNotes,
        ...acquisition.notes,
        `Comparison recommendations: ${comparison.map((c) => c.recommendationReason).join("; ")}`,
      ].join(" | "),
      lineItems: {
        create: lineItems.map((l) => {
          const unit = publicUnitPriceFor(l.description) ?? 0;
          const qty = Number(l.quantity);
          const lineCost = unit * qty;
          const lineSell = lineCost * 1.2;
          return {
            rfqLineItemId: l.id,
            description: l.description,
            quantity: qty,
            unitCost: unit,
            lineCost,
            unitSell: qty ? lineSell / qty : 0,
            lineSell,
          };
        }),
      },
    },
  });

  await writeAuditEvent({
    action: "PRICING_CALCULATED",
    entityType: "PricingScenario",
    entityId: scenario.id,
    metadata: { gate: gate.gate, landedCost: pricing.landedCost },
  });

  const next = determineNextAction({
    status: "PRICING",
    qualificationGate: "AMBER",
    commercialGate: gate.gate,
    hardNoBid: false,
    classification: "SUPPLY_AND_DELIVER",
    selectedCompanyId: company.id,
    briefingCompulsory: false,
    briefingCompulsoryKnown: true,
    documentCount: 1,
    documentsDownloaded: true,
    extractionDone: true,
    extractionVerified: true,
    lineItemCount: lineItems.length,
    supplierCount: suppliers.length,
    enquiryDraftCount: suppliers.length,
    quoteCount: 2,
    hasSupplierQuote: false,
    pricingComplete: true,
    productMatchVerified: false,
    logisticsCalculated: true,
    hasOemRequirement: false,
    closingAt: rfq.closingAt,
  });

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      status: "PRICING",
      qualificationGate: "AMBER",
      profitabilityGate: gate.gate,
      nextAction: next.action,
      nextActionReason: next.reason,
      opportunityScoreNotes: `Phase3 commercial gate ${gate.gate}`,
    },
  });

  await writeAuditEvent({
    action: "COMMERCIAL_GATE_SET",
    entityType: "Rfq",
    entityId: rfq.id,
    newState: { gate: gate.gate, reasons: gate.reasons, next: next.action },
  });

  console.log(
    JSON.stringify(
      {
        rfq: rfq.internalId,
        lineItems: lineItems.length,
        suppliers: suppliers.map((s) => s.name),
        goodsCost,
        acquisition,
        deliveryCost,
        pricing,
        workingCapital: wc,
        commercialGate: gate,
        next,
        scenarioId: scenario.id,
        comparison,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
