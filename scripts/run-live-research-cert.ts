/**
 * Live Web Product Research V1 certification.
 * 1) BID-000011 live (catalogue not primary)
 * 2) One novel Supply & Deliver RFQ
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

async function downloadToFile(url: string, dest: string) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "BiddifyResearchBot/1.0 (certification document fetch)",
    },
  });
  if (!res.ok) throw new Error(`Download failed ${res.status} ${url}`);
  await mkdir(path.dirname(dest), { recursive: true });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  return buf;
}

async function prepareNovelLaptopRfq() {
  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000009" },
    include: { documents: true, selectedCompany: true, lineItems: true },
  });
  if (!rfq) throw new Error("BID-000009 not found");

  // Clear any prior seeded lines/quotes — novel RFQ must not have manual prices
  await prisma.supplierQuote.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.rfqLineItem.deleteMany({ where: { rfqId: rfq.id } });

  const doc = rfq.documents[0];
  if (!doc?.sourceUrl) throw new Error("BID-000009 has no source document URL");

  const dest = path.join(
    process.cwd(),
    "tmp",
    "cert",
    "BID-000009-laptops.pdf",
  );
  let text = doc.extractedText;
  try {
    const buf = await downloadToFile(doc.sourceUrl, dest);
    // pdf-parse
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse = (mod.default ?? mod) as (
      b: Buffer,
    ) => Promise<{ text: string }>;
    const parsed = await pdfParse(buf);
    text = parsed.text;
    await prisma.rfqDocument.update({
      where: { id: doc.id },
      data: {
        localPath: dest,
        extractedText: text,
        extractedAt: new Date(),
        processingState: "EXTRACTED",
        byteSize: buf.length,
      },
    });
  } catch (err) {
    console.warn("PDF download/parse issue — using heuristic laptop BOQ", err);
  }

  // Prefer extracted laptop specs; fall back to title-based novel BOQ (still unpriced)
  const lines: Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    brandRequirement?: string;
    equivalentAllowed: boolean;
  }> = [];

  const blob = (text ?? rfq.title + " " + (rfq.description ?? "")).replace(
    /\s+/g,
    " ",
  );
  const laptopHint =
    blob.match(
      /(\d+)\s*[x×]?\s*(?:laptops?|notebooks?).{0,120}/i,
    )?.[0] ?? null;

  if (/five\s+laptops|5\s+laptops/i.test(blob) || /FIVE LAPTOPS/i.test(doc.fileName)) {
    // Novel commercial lines — no prices seeded
    lines.push({
      lineNumber: 1,
      description:
        laptopHint?.slice(0, 160) ||
        "Laptop notebook computer business grade Windows 11 Pro 16GB RAM 512GB SSD",
      quantity: 5,
      unit: "EA",
      equivalentAllowed: true,
    });
  } else {
    // Still create at least one supply line from document keywords
    lines.push({
      lineNumber: 1,
      description: "Laptop computer for office use",
      quantity: 5,
      unit: "EA",
      equivalentAllowed: true,
    });
  }

  // Try to pull brand/model from text
  const brand = blob.match(/\b(HP|Dell|Lenovo|Apple|Acer|Asus)\b/i)?.[1];
  if (brand) {
    lines[0].brandRequirement = brand;
    lines[0].description = `${brand} ${lines[0].description}`;
  }

  for (const l of lines) {
    await prisma.rfqLineItem.create({
      data: {
        rfqId: rfq.id,
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        brandRequirement: l.brandRequirement,
        equivalentAllowed: l.equivalentAllowed,
        verificationStatus: "EXTRACTED_UNVERIFIED",
        extractionMethod: "live-research-cert-novel",
        extractionConfidence: 0.55,
      },
    });
  }

  // Ensure company selected for quotation path
  if (!rfq.selectedCompanyId) {
    const orison = await prisma.company.findFirst({
      where: { legalName: { contains: "ORISON" } },
    });
    if (orison) {
      await prisma.rfq.update({
        where: { id: rfq.id },
        data: { selectedCompanyId: orison.id },
      });
    }
  }

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      classification: "SUPPLY_AND_DELIVER",
      classificationConfidence: 0.8,
      classificationReasoning: "Supply of laptops — goods",
      classificationSource: "HEURISTIC",
    },
  });

  return rfq.internalId;
}

async function summarize(internalId: string) {
  const rfq = await prisma.rfq.findFirst({
    where: { internalId },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
      productResearchCandidates: {
        orderBy: [{ selected: "desc" }, { createdAt: "asc" }],
      },
      researchObservations: { orderBy: { createdAt: "asc" }, take: 200 },
      autonomousQuotations: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!rfq) return null;
  const run = rfq.autonomousRunJson
    ? JSON.parse(rfq.autonomousRunJson)
    : null;
  return {
    internalId,
    outcome: rfq.autonomousOutcome,
    state: rfq.autonomousState,
    confidence: rfq.autonomousConfidence,
    durationMs: rfq.autonomousDurationMs,
    webResearchCoverage: rfq.webResearchCoverage,
    liveResearchMetrics: rfq.liveResearchMetricsJson
      ? JSON.parse(rfq.liveResearchMetricsJson)
      : null,
    classification: rfq.classification,
    lines: rfq.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: Number(l.quantity),
      candidates: rfq.productResearchCandidates
        .filter((c) => c.rfqLineItemId === l.id)
        .map((c) => ({
          product: c.productName,
          url: c.productUrl,
          price: c.price != null ? Number(c.price) : null,
          match: c.matchVerdict,
          selected: c.selected,
          status: c.selectionStatus,
          reason: c.selectionReason,
          provider: c.researchProvider,
          source: c.sourceName,
        })),
    })),
    queries: rfq.researchObservations
      .filter((o) => o.eventType === "SEARCH_QUERY_GENERATED")
      .map((o) => o.queryText),
    pagesInspected: rfq.researchObservations.filter(
      (o) => o.eventType === "PRODUCT_PAGE_INSPECTED",
    ).length,
    pricing: run?.artifacts?.pricing ?? null,
    markup: run?.artifacts?.markup ?? null,
    riskAllowance: run?.artifacts?.riskAllowance ?? null,
    quotation: rfq.autonomousQuotations[0]
      ? {
          number: rfq.autonomousQuotations[0].quotationNumber,
          total: Number(rfq.autonomousQuotations[0].totalAmount),
          customerFacing: JSON.parse(
            rfq.autonomousQuotations[0].customerFacingJson,
          ),
        }
      : null,
    reasons: run?.reasons ?? [],
  };
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
        mode: "LIVE_WEB_PRIMARY",
        safety: {
          TENDERS_SUBMITTED: "NO",
          EMAILS_SENT: "NO",
          SUPPLIERS_CONTACTED: "NO",
          PURCHASES_MADE: "NO",
        },
      },
      null,
      2,
    ),
  );

  // —— BID-000011 live ——
  await resetAutonomous("BID-000011");
  const bid11Results = await runAutonomousQueue(prisma, {
    limit: 1,
    preferInternalId: "BID-000011",
    processOpts: {
      preferLiveWeb: true,
      catalogueFallback: false, // do not seed from old evidence as primary
    },
  });
  const bid11 = await summarize("BID-000011");

  // —— Novel RFQ ——
  const novelId = await prepareNovelLaptopRfq();
  await resetAutonomous(novelId);
  const novelResults = await runAutonomousQueue(prisma, {
    limit: 1,
    preferInternalId: novelId,
    processOpts: {
      preferLiveWeb: true,
      catalogueFallback: false,
    },
  });
  const novel = await summarize(novelId);

  const report = {
    worker: WORKER_VERSION,
    bid000011: { results: bid11Results, summary: bid11 },
    novelRfq: { results: novelResults, summary: novel },
    comparisonNote:
      "BID-000011 live results are independent of prior R27,475 catalogue cost",
    safety: {
      TENDERS_SUBMITTED: "NO",
      EMAILS_SENT: "NO",
      SUPPLIERS_CONTACTED: "NO",
      PURCHASES_MADE: "NO",
      AUTONOMOUS_WEB_RESEARCH: "ON",
      AUTONOMOUS_PREPARATION: "ON",
      AUTONOMOUS_SUBMISSION: "OFF",
    },
  };

  const outPath = path.join(process.cwd(), "tmp", "cert", "live-research-cert.json");
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
