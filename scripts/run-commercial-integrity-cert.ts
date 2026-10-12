/**
 * Commercial Pricing Integrity V1 certification.
 * 1) BID-000011 forensic (old ~R27k vs live)
 * 2) BID-000009 Dell EACH control
 * 3) Novel pack/unit RFQ (BID-DEMO-0001 stationery)
 * Never submits / emails / contacts suppliers / purchases.
 */

import "dotenv/config";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/db";
import {
  runAutonomousQueue,
  WORKER_VERSION,
} from "../src/services/autonomous/worker";
import { reconcileQuantity } from "../src/domain/quantityReconciliation";

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
        where: { selected: true },
        orderBy: { createdAt: "asc" },
      },
      autonomousQuotations: { orderBy: { createdAt: "desc" }, take: 1 },
      lineItems: { orderBy: { lineNumber: "asc" } },
      quotes: { include: { lineItems: true } },
    },
  });
  const runJson = refreshed?.autonomousRunJson
    ? JSON.parse(refreshed.autonomousRunJson)
    : null;
  return { results, refreshed, runJson };
}

function oldEconomicsBid11() {
  return [
    {
      line: 1,
      desc: "DISHWASHING LIQUID 750ML",
      qty: 60,
      unit: "EA",
      oldProduct: "Public ref dishwashing 750ml",
      oldPack: "assumed EACH",
      oldUnitCost: 28.5,
      oldTotal: 60 * 28.5,
    },
    {
      line: 2,
      desc: "TOWEL PAPER 280MM X 1500 METER",
      qty: 75,
      unit: "EA",
      oldProduct: "Public ref paper towel roll",
      oldPack: "assumed EACH/ROLL",
      oldUnitCost: 210,
      oldTotal: 75 * 210,
    },
    {
      line: 3,
      desc: "Cotton Wool Roll 500g",
      qty: 100,
      unit: "EA",
      oldProduct: "Public ref cotton wool 500g",
      oldPack: "assumed EACH/ROLL",
      oldUnitCost: 55,
      oldTotal: 100 * 55,
    },
    {
      line: 4,
      desc: "TOOL BATTERY AA",
      qty: 240,
      unit: "EA",
      oldProduct: "Public ref AA battery",
      oldPack: "assumed PER_EACH (likely pack-as-each error risk)",
      oldUnitCost: 9.5,
      oldTotal: 240 * 9.5,
    },
    {
      line: 5,
      desc: "Size AAA Duracell battery",
      qty: 150,
      unit: "EA",
      oldProduct: "Public ref AAA Duracell",
      oldPack: "assumed PER_EACH (likely pack-as-each error risk)",
      oldUnitCost: 14.9,
      oldTotal: 150 * 14.9,
    },
  ];
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
        slice: "commercial-pricing-integrity-v1",
        prep: "ON",
        submission: "OFF",
        commercialIntegrityGate: "ON",
      },
      null,
      2,
    ),
  );

  // —— 1. BID-000011 forensic ——
  const bid11 = await runOne("BID-000011");
  const oldRows = oldEconomicsBid11();
  const oldProductTotal = oldRows.reduce((s, r) => s + r.oldTotal, 0);

  const forensicTable = oldRows.map((old) => {
    const liveLine = (bid11.runJson?.artifacts?.pricing?.lines ?? []).find(
      (l: { lineNumber: number }) => l.lineNumber === old.line,
    );
    const cand = bid11.refreshed?.productResearchCandidates.find((c) => {
      const li = bid11.refreshed?.lineItems.find((x) => x.id === c.rfqLineItemId);
      return li?.lineNumber === old.line;
    });
    const recon = cand?.packCalculationJson
      ? JSON.parse(cand.packCalculationJson)
      : liveLine?.reconciliation ?? null;

    const liveTotal =
      recon?.procurementCost ?? liveLine?.productCost ?? null;
    const variance =
      liveTotal != null ? liveTotal - old.oldTotal : null;
    let rootCause = "INSUFFICIENT_LIVE_EVIDENCE";
    if (liveTotal == null) rootCause = "LIVE_UNRESOLVED_OR_NOT_FIRM";
    else if (Math.abs(variance!) / old.oldTotal > 0.75) {
      if (recon && !recon.firm) rootCause = "LIVE_PACK_BASIS_UNKNOWN";
      else if ((recon?.supplierPackSize ?? 1) > 1)
        rootCause =
          "PACK_VS_UNIT — live uses pack economics; old public-ref likely treated pack/list price as EACH";
      else
        rootCause =
          "REAL_MARKET_OR_SPEC_DIFFERENCE — different product/source vs stale public-ref";
    } else {
      rootCause = "WITHIN_NORMAL_TO_HIGH_VARIANCE";
    }

    return {
      boqLine: old.line,
      tenderQuantityUnit: `${old.qty} ${old.unit}`,
      oldProduct: old.oldProduct,
      oldPackInterpretation: old.oldPack,
      oldUnitCost: old.oldUnitCost,
      oldTotal: old.oldTotal,
      liveProduct: cand?.productName ?? null,
      liveSellingUnit: recon?.supplierSellingUnit ?? null,
      livePackSize: recon?.supplierPackSize ?? null,
      livePriceBasis: recon?.supplierPriceBasis ?? null,
      packsRequired: recon?.packsRequired ?? null,
      liveEffectiveUnitCost: recon?.effectiveTenderUnitCost ?? liveLine?.unitCost ?? null,
      liveTotal,
      variance,
      rootCause,
      reconFirm: recon?.firm ?? false,
      humanReadable: recon?.humanReadable ?? null,
    };
  });

  const liveProductTotal =
    bid11.runJson?.artifacts?.pricing?.productCost ??
    forensicTable.reduce((s, r) => s + (r.liveTotal ?? 0), 0);

  const verdictParts = forensicTable.map((r) => {
    if (r.liveTotal == null) return "LIVE_INCOMPLETE";
    if (/PACK_VS_UNIT|PACK_BASIS/.test(r.rootCause)) return "OLD_LIKELY_WRONG_OR_AMBIGUOUS";
    if (/REAL_MARKET/.test(r.rootCause)) return "REAL_MARKET_DIFFERENCE";
    return "COMPARE";
  });
  const overallVerdict = verdictParts.includes("LIVE_INCOMPLETE")
    ? "BOTH_PARTIALLY_WRONG_OR_INCOMPLETE — live blocked non-firm pack evidence; old public-ref lacked pack basis"
    : verdictParts.filter((v) => v === "OLD_LIKELY_WRONG_OR_AMBIGUOUS").length >= 2
      ? "OLD_WRONG_OR_AMBIGUOUS_PACK_BASIS + LIVE_CORRECTED_WHERE_FIRM"
      : "MIXED — inspect line table";

  // —— 2. BID-000009 control ——
  const bid09 = await runOne("BID-000009");
  const line09 = bid09.runJson?.artifacts?.pricing?.lines?.[0];
  const recon09 = line09?.reconciliation;
  const control = {
    tenderQuantity: 5,
    supplierSellingUnit: recon09?.supplierSellingUnit ?? null,
    priceBasis: recon09?.supplierPriceBasis ?? null,
    packsRequired: recon09?.packsRequired ?? null,
    unitCost: line09?.unitCost ?? null,
    procurement: bid09.runJson?.artifacts?.pricing?.productCost ?? null,
    quotation: bid09.refreshed?.autonomousQuotations[0]
      ? Number(bid09.refreshed.autonomousQuotations[0].totalAmount)
      : null,
    expectedProcurement: 5 * 19499,
    expectedQuotation: 116994,
    matchesPrior:
      Math.abs((bid09.runJson?.artifacts?.pricing?.productCost ?? 0) - 97495) < 1 ||
      Math.abs((line09?.unitCost ?? 0) - 19499) < 1,
    outcome: bid09.refreshed?.autonomousOutcome,
    reasons: bid09.runJson?.reasons ?? [],
    reconciliation: recon09,
  };

  // —— 3. Novel pack RFQ ——
  let novelId = "BID-DEMO-0001";
  const novelExists = await prisma.rfq.findFirst({
    where: { internalId: novelId },
    include: { lineItems: true },
  });
  if (!novelExists || novelExists.lineItems.length === 0) {
    novelId = "BID-DEMO-0003";
  }
  // Ensure classification so worker accepts it
  await prisma.rfq.updateMany({
    where: { internalId: novelId },
    data: {
      classification: "SUPPLY_AND_DELIVER",
      classificationConfidence: 0.9,
    },
  });
  const novel = await runOne(novelId);

  const report = {
    worker: WORKER_VERSION,
    bid000011: {
      outcome: bid11.refreshed?.autonomousOutcome,
      confidence: bid11.refreshed?.autonomousConfidence,
      oldProductEconomics: oldProductTotal,
      liveProductEconomics: liveProductTotal,
      variancePercent:
        oldProductTotal > 0
          ? ((liveProductTotal - oldProductTotal) / oldProductTotal) * 100
          : null,
      overallVerdict,
      forensicTable,
      correctedProcurement: liveProductTotal,
      correctedQuotation: bid11.refreshed?.autonomousQuotations[0]
        ? Number(bid11.refreshed.autonomousQuotations[0].totalAmount)
        : null,
      integrity: bid11.runJson?.artifacts?.commercialIntegrity ?? null,
      variance: bid11.runJson?.artifacts?.priceVariance ?? null,
      waterfall: bid11.runJson?.artifacts?.costWaterfall ?? null,
      integrityMetrics: bid11.runJson?.artifacts?.integrityMetrics ?? null,
      reasons: bid11.runJson?.reasons ?? [],
      results: bid11.results,
    },
    bid000009: control,
    novel: {
      internalId: novelId,
      outcome: novel.refreshed?.autonomousOutcome,
      lines: novel.refreshed?.lineItems.map((l) => ({
        n: l.lineNumber,
        q: Number(l.quantity),
        u: l.unit,
        d: l.description,
      })),
      pricing: novel.runJson?.artifacts?.pricing ?? null,
      reconciliations: novel.runJson?.artifacts?.quantityReconciliations ?? null,
      integrity: novel.runJson?.artifacts?.commercialIntegrity ?? null,
      integrityMetrics: novel.runJson?.artifacts?.integrityMetrics ?? null,
      reasons: novel.runJson?.reasons ?? [],
      quotation: novel.refreshed?.autonomousQuotations[0]
        ? Number(novel.refreshed.autonomousQuotations[0].totalAmount)
        : null,
    },
    safety: {
      TENDERS_SUBMITTED: "NO",
      EMAILS_SENT: "NO",
      SUPPLIERS_CONTACTED: "NO",
      PURCHASES_MADE: "NO",
      AUTONOMOUS_WEB_RESEARCH: "ON",
      AUTONOMOUS_PREPARATION: "ON",
      COMMERCIAL_INTEGRITY_GATE: "ON",
      AUTONOMOUS_SUBMISSION: "OFF",
    },
  };

  const outDir = path.join(process.cwd(), "tmp", "cert");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "commercial-integrity-v1.json");
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);

  // Smoke: pack-of-4 invariant still holds in-process
  const smoke = reconcileQuantity({
    tenderQuantity: 100,
    tenderUnit: "EA",
    productName: "Duracell AAA Pack of 4",
    observedSupplierPrice: 89.99,
  });
  if (smoke.packsRequired !== 25 || smoke.procurementCost !== 2249.75) {
    throw new Error("Integrity smoke failed");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
