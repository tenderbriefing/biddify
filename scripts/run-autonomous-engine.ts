/**
 * Autonomous RFQ Engine V1 certification runner.
 * Default: process BID-000011 then stop.
 * Never submits tenders, sends email, or makes purchases.
 */

import "dotenv/config";
import { prisma } from "../src/lib/db";
import {
  runAutonomousQueue,
  WORKER_VERSION,
} from "../src/services/autonomous/worker";

async function main() {
  const target = process.argv[2] ?? "BID-000011";
  const limit = Number(process.argv[3] ?? "1");

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

  // Reset autonomous lifecycle for certification target only (preserve quotes/evidence).
  const rfq = await prisma.rfq.findFirst({ where: { internalId: target } });
  if (!rfq) {
    throw new Error(`RFQ ${target} not found`);
  }

  await prisma.productResearchCandidate.deleteMany({ where: { rfqId: rfq.id } });
  await prisma.autonomousQuotation.deleteMany({ where: { rfqId: rfq.id } });
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
    },
  });

  console.log(
    JSON.stringify(
      {
        worker: WORKER_VERSION,
        target,
        prep: "ON",
        submission: "OFF",
        note: "Using existing evidence only — no fabricated prices",
      },
      null,
      2,
    ),
  );

  const results = await runAutonomousQueue(prisma, {
    limit,
    preferInternalId: target,
  });

  const refreshed = await prisma.rfq.findFirst({
    where: { internalId: target },
    include: {
      productResearchCandidates: {
        orderBy: [{ rfqLineItemId: "asc" }, { selected: "desc" }],
      },
      autonomousQuotations: { orderBy: { createdAt: "desc" }, take: 1 },
      lineItems: { orderBy: { lineNumber: "asc" } },
      selectedCompany: true,
    },
  });

  const runJson = refreshed?.autonomousRunJson
    ? JSON.parse(refreshed.autonomousRunJson)
    : null;

  const report = {
    target,
    results,
    autonomousState: refreshed?.autonomousState,
    autonomousOutcome: refreshed?.autonomousOutcome,
    confidence: refreshed?.autonomousConfidence,
    durationMs: refreshed?.autonomousDurationMs,
    worker: refreshed?.autonomousWorkerVersion,
    classification: {
      class: refreshed?.classification,
      confidence: refreshed?.classificationConfidence,
      reasoning: refreshed?.classificationReasoning,
    },
    documents: runJson?.artifacts?.documents ?? null,
    boq: runJson?.artifacts?.boq ?? null,
    researchSummary: refreshed?.productResearchCandidates.map((c) => ({
      lineItemId: c.rfqLineItemId,
      product: c.productName,
      source: c.sourceName,
      price: c.price != null ? Number(c.price) : null,
      evidenceLevel: c.evidenceLevel,
      matchVerdict: c.matchVerdict,
      selected: c.selected,
    })),
    matching: runJson?.artifacts?.matching ?? null,
    pricing: runJson?.artifacts?.pricing ?? null,
    markup: runJson?.artifacts?.markup ?? null,
    quotation: refreshed?.autonomousQuotations[0]
      ? {
          number: refreshed.autonomousQuotations[0].quotationNumber,
          total: Number(refreshed.autonomousQuotations[0].totalAmount),
          customerFacing: JSON.parse(
            refreshed.autonomousQuotations[0].customerFacingJson,
          ),
        }
      : null,
    reasons: runJson?.reasons ?? results[0]?.reasons ?? [],
    safety: {
      TENDERS_SUBMITTED: "NO",
      EMAILS_SENT: "NO",
      PURCHASES_MADE: "NO",
      AUTONOMOUS_PREPARATION: "ON",
      AUTONOMOUS_SUBMISSION: "OFF",
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
