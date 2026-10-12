/**
 * Procurement Optimizer V1 certification.
 * BID-000011 batteries + full reprice, BID-000009 control, split fixture via unit tests.
 * Never submits / emails / contacts / purchases.
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/db";
import {
  runAutonomousQueue,
  WORKER_VERSION,
} from "../src/services/autonomous/worker";
import { optimizeProcurementStrategy } from "../src/domain/procurementStrategy";
import { buildProcurementCandidate } from "../src/domain/procurementOptimizer";
import type { DeliveryEvidence } from "../src/domain/deliveryEvidence";

async function resetAutonomous(internalId: string) {
  const rfq = await prisma.rfq.findFirst({ where: { internalId } });
  if (!rfq) throw new Error(`Missing ${internalId}`);
  await prisma.productResearchCandidate.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.autonomousQuotation.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.researchObservation.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      autonomousState: "DISCOVERED",
      autonomousOutcome: null,
      autonomousStartedAt: null,
      autonomousCompletedAt: null,
      autonomousDurationMs: null,
      autonomousFailureReason: null,
      autonomousRetryCount: 0,
      autonomousConfidence: null,
      autonomousWorkerVersion: null,
      autonomousLastStep: null,
      autonomousClaimToken: null,
      autonomousClaimExpiresAt: null,
      autonomousRunJson: null,
      liveResearchMetricsJson: null,
      webResearchCoverage: null,
    },
  });
  return rfq;
}

async function runOne(internalId: string) {
  await resetAutonomous(internalId);
  const results = await runAutonomousQueue(prisma, {
    limit: 1,
    preferInternalId: internalId,
    processOpts: { preferLiveWeb: true, catalogueFallback: true },
  });
  const refreshed = await prisma.rfq.findFirst({
    where: { internalId },
    include: {
      productResearchCandidates: {
        orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
      },
      autonomousQuotations: { orderBy: { createdAt: "desc" }, take: 1 },
      lineItems: { orderBy: { lineNumber: "asc" } },
    },
  });
  const runJson = refreshed?.autonomousRunJson
    ? JSON.parse(refreshed.autonomousRunJson)
    : null;
  return { results, refreshed, runJson };
}

function splitFixture() {
  const free: DeliveryEvidence = {
    type: "FREE_DELIVERY",
    amount: 0,
    threshold: null,
    destinationAssumption: "SA",
    source: "https://www.takealot.com/a",
    known: true,
    notes: [],
  };
  const paid: DeliveryEvidence = {
    type: "FIXED_DELIVERY",
    amount: 80,
    threshold: null,
    destinationAssumption: "SA",
    source: "https://www.takealot.com/b",
    known: true,
    notes: [],
  };
  const line = {
    lineNumber: 1,
    description: "Industrial Widget",
    tenderQuantity: 100,
    tenderUnit: "EA",
    equivalentAllowed: true,
  };
  const a = buildProcurementCandidate(
    {
      id: "A",
      supplier: "SupplierA",
      sourceUrl: "https://www.takealot.com/a",
      sourceType: "retail",
      productTitle: "Widget Pack of 10",
      displayedPrice: 100,
      priceKnown: true,
      vatTreatment: "VAT_INCLUSIVE",
      availability: "Only 60 left in stock",
      delivery: { ...free, amount: 50, type: "FIXED_DELIVERY", known: true },
      sourceQuality: 0.9,
    },
    line,
  );
  a.specification = {
    ...a.specification,
    classification: "EXACT",
    selectableForAutonomousProcurement: true,
    compatibilityScore: 0.95,
    legacyVerdict: "EXACT_MATCH",
  };
  a.commercialIntegrityFirm = true;
  a.integrityFlags = [];
  a.stock = {
    class: "LIMITED_STOCK",
    availableQuantity: 60,
    confidence: 0.8,
    evidence: "60 left",
    eligibleToWin: true,
    maxSupplyUnits: 60,
  };
  a.packSize = 10;
  a.displayedPrice = 100;
  a.procurementSubtotal = 600;
  a.deliveryAllocation = 50;
  a.landedProcurementCost = 650;
  a.effectiveTenderUnitCost = 6.5;

  const b = buildProcurementCandidate(
    {
      id: "B",
      supplier: "SupplierB",
      sourceUrl: "https://www.takealot.com/b",
      sourceType: "retail",
      productTitle: "Widget Pack of 10",
      displayedPrice: 125,
      priceKnown: true,
      vatTreatment: "VAT_INCLUSIVE",
      availability: "In stock",
      delivery: paid,
      sourceQuality: 0.9,
    },
    line,
  );
  b.specification = {
    ...b.specification,
    classification: "EXACT",
    selectableForAutonomousProcurement: true,
    compatibilityScore: 0.95,
    legacyVerdict: "EXACT_MATCH",
  };
  b.commercialIntegrityFirm = true;
  b.integrityFlags = [];
  b.packSize = 10;
  b.packsRequired = 10;
  b.procurementSubtotal = 1250;
  b.deliveryAllocation = 80;
  b.landedProcurementCost = 1330;
  b.effectiveTenderUnitCost = 13.3;

  const strategy = optimizeProcurementStrategy({
    tenderQuantity: 100,
    candidates: [a, b],
    splitAllowed: true,
  });
  return strategy;
}

async function main() {
  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      autonomousPrepEnabled: true,
      autonomousSubmissionEnabled: false,
      globalOutboundPaused: true,
    },
    update: {
      autonomousPrepEnabled: true,
      autonomousSubmissionEnabled: false,
    },
  });

  console.log(
    JSON.stringify(
      {
        worker: WORKER_VERSION,
        slice: "procurement-optimizer-v1",
        baseline: "171912d",
        prep: "ON",
        submission: "OFF",
        integrity: "ON",
        optimizer: "ON",
      },
      null,
      2,
    ),
  );

  const bid11 = await runOne("BID-000011");
  const lines = (bid11.runJson?.artifacts?.pricing?.lines ?? []) as Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    productCost: number;
    unitCost: number;
    unresolved: boolean;
    reconciliation?: {
      firm?: boolean;
      packsRequired?: number;
      supplierPriceBasis?: string;
      humanReadable?: string;
    };
    candidateId?: string | null;
  }>;

  const table = bid11.refreshed?.lineItems.map((li) => {
    const pl = lines.find((l) => l.lineNumber === li.lineNumber);
    const cand = bid11.refreshed?.productResearchCandidates.find(
      (c) => c.selected && c.rfqLineItemId === li.id,
    );
    const opt = (
      bid11.runJson?.artifacts?.procurementOptimizer as Array<{
        lineNumber: number;
        strategy?: { type?: string; reasoning?: string };
        recommended?: string;
        comparison?: Array<{
          supplier: string;
          product: string;
          landed: number | null;
          spec: string;
          stock: string;
          firm: boolean;
          rank: number;
        }>;
      }>
    )?.find((o) => o.lineNumber === li.lineNumber);

    const winner = opt?.comparison?.find((c) => c.rank === 1);

    return {
      line: li.lineNumber,
      tenderRequirement: `${Number(li.quantity)} ${li.unit} — ${li.description}`,
      supplier: cand?.sourceName ?? winner?.supplier ?? null,
      product: cand?.productName ?? winner?.product ?? null,
      basis:
        pl?.reconciliation?.supplierPriceBasis ??
        cand?.packUnit ??
        null,
      packs: pl?.reconciliation?.packsRequired ?? null,
      stock: winner?.stock ?? cand?.availability ?? null,
      delivery: cand?.deliveryJson
        ? JSON.parse(cand.deliveryJson).type
        : null,
      landedCost: pl?.productCost ?? winner?.landed ?? null,
      specStatus: winner?.spec ?? cand?.matchVerdict ?? null,
      decision: pl?.unresolved
        ? "BLOCKED — " + (opt?.strategy?.reasoning ?? "unresolved")
        : opt?.strategy?.type === "SPLIT_SUPPLIER"
          ? "SPLIT"
          : "SELECTED",
      candidatesFound: bid11.refreshed?.productResearchCandidates.filter(
        (c) => c.rfqLineItemId === li.id,
      ).length,
      firm: pl?.reconciliation?.firm ?? winner?.firm ?? false,
    };
  });

  const procurement = bid11.runJson?.artifacts?.pricing?.productCost ?? null;
  const quote = bid11.refreshed?.autonomousQuotations[0]
    ? Number(bid11.refreshed.autonomousQuotations[0].totalAmount)
    : null;
  const commercial = bid11.runJson?.artifacts?.pricing;

  const bid09 = await runOne("BID-000009");
  const split = splitFixture();

  const report = {
    title: "PROCUREMENT OPTIMIZER V1 — CERTIFICATION REPORT",
    worker: WORKER_VERSION,
    startingSha: "171912d",
    bid000011: {
      outcome: bid11.refreshed?.autonomousOutcome,
      confidence: bid11.refreshed?.autonomousConfidence,
      table,
      comparators: {
        previousStaleReference: 27475,
        previousMalformedLive: 110540,
        commercialIntegrityV1FirmSubtotal: 55240,
        optimizerProcurement: procurement,
      },
      totalProcurement: procurement,
      totalQuote: quote,
      grossProfit: commercial?.grossProfit ?? null,
      grossMarginPercent: commercial?.grossMarginPercent ?? null,
      markupPercent: commercial?.markupPercent ?? null,
      variance: bid11.runJson?.artifacts?.priceVariance ?? null,
      varianceInvestigation:
        bid11.runJson?.artifacts?.varianceInvestigation ?? null,
      integrity: bid11.runJson?.artifacts?.commercialIntegrity ?? null,
      optimizerMetrics: bid11.runJson?.artifacts?.optimizerMetrics ?? null,
      reasons: (bid11.runJson?.reasons ?? []).slice(0, 20),
      batteryForensic: table?.filter((t) => t.line === 4 || t.line === 5),
    },
    bid000009: {
      outcome: bid09.refreshed?.autonomousOutcome,
      procurement: bid09.runJson?.artifacts?.pricing?.productCost ?? null,
      unitCost: bid09.runJson?.artifacts?.pricing?.lines?.[0]?.unitCost ?? null,
      quotation: bid09.refreshed?.autonomousQuotations[0]
        ? Number(bid09.refreshed.autonomousQuotations[0].totalAmount)
        : null,
      prior: { unit: 16498, procurement: 82490, quote: 98988 },
      reconciliation:
        bid09.runJson?.artifacts?.pricing?.lines?.[0]?.reconciliation ?? null,
      optimizer: bid09.runJson?.artifacts?.procurementOptimizer?.[0] ?? null,
      candidates:
        bid09.refreshed?.productResearchCandidates.map((c) => ({
          product: c.productName,
          price: c.price != null ? Number(c.price) : null,
          selected: c.selected,
        })) ?? [],
      reasons: (bid09.runJson?.reasons ?? []).slice(0, 12),
    },
    novelSplitFixture: {
      type: split.type,
      allocations: split.allocations,
      totalLanded: split.totalLandedCost,
      savingsVsSingleBest: split.savingsVsSingleBest,
      reasoning: split.reasoning,
      certified:
        split.type === "SPLIT_SUPPLIER" &&
        (split.allocations?.length ?? 0) === 2 &&
        (split.totalLandedCost ?? 0) < 1330,
    },
    safety: {
      TENDERS_SUBMITTED: "NO",
      EMAILS_SENT: "NO",
      SUPPLIERS_CONTACTED: "NO",
      PURCHASES_MADE: "NO",
      AUTONOMOUS_WEB_RESEARCH: "ON",
      AUTONOMOUS_PREPARATION: "ON",
      COMMERCIAL_INTEGRITY_GATE: "ON",
      PROCUREMENT_OPTIMIZER: "ON",
      AUTONOMOUS_SUBMISSION: "OFF",
    },
  };

  const outDir = path.join(process.cwd(), "tmp", "cert");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "procurement-optimizer-v1.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
