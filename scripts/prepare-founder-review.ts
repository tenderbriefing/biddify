/**
 * Persist vertical-slice Founder review pack for a real RFQ (default BID-000011).
 * Does NOT send email. Does NOT submit tenders. Autonomy remains OFF.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { prepareFounderReviewForRfq } from "../src/services/bid/prepareFounderReview";
import { buildFounderReviewPack } from "../src/domain/founderReviewPack";
import { evaluateDeadline } from "../src/domain/deadlines";
import { formatClosingDisplay } from "../src/domain/deadlineParse";
import { evaluateComplianceGate } from "../src/domain/compliance";

async function main() {
  const internalId = process.argv[2] ?? "BID-000011";
  const result = await prepareFounderReviewForRfq(prisma, internalId);

  const rfq = await prisma.rfq.findFirstOrThrow({
    where: { internalId },
    include: {
      selectedCompany: true,
      lineItems: { orderBy: { lineNumber: "asc" } },
      pricingScenarios: { where: { isSelected: true }, take: 1 },
      sourcingRequests: { include: { supplier: true } },
      complianceItems: true,
    },
  });

  const deadline = evaluateDeadline(rfq.closingAt, new Date(), rfq.timezone);
  const pricing = rfq.pricingScenarios[0];
  const compliance = evaluateComplianceGate(rfq.complianceItems);
  let eligibility: { verdict?: string; warnings?: string[] } = {};
  try {
    eligibility = JSON.parse(rfq.companySelectionReason ?? "{}").eligibility ?? {};
  } catch {
    eligibility = {};
  }

  const pack = buildFounderReviewPack({
    internalId: rfq.internalId,
    title: rfq.title,
    buyer: rfq.buyer,
    closingDisplay: formatClosingDisplay(
      rfq.closingAt,
      rfq.closingTimeKnown,
      rfq.timezone,
    ),
    hoursRemaining: deadline.hoursRemaining,
    isClosed: deadline.isClosed,
    classification: rfq.classification,
    eligibilityVerdict: eligibility.verdict ?? null,
    eligibilityExplanation: (eligibility.warnings ?? []).join("; ") || null,
    selectedCompanyName:
      rfq.selectedCompany?.tradingName ?? rfq.selectedCompany?.legalName,
    recommendedCompanyName: null,
    lineItems: rfq.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      brandRequirement: l.brandRequirement,
    })),
    suppliers: rfq.sourcingRequests.map((s) => ({
      name: s.supplier.name,
      email: s.recipientEmail,
      lifecycleStatus: s.lifecycleStatus,
    })),
    landedCost: pricing ? Number(pricing.landedCost) : null,
    sellingPrice: pricing ? Number(pricing.totalQuotation) : null,
    grossProfit: pricing ? Number(pricing.grossProfit) : null,
    grossMarginPercent: pricing ? Number(pricing.grossMarginPercent) : null,
    markupPercent: pricing ? Number(pricing.markupPercent) : null,
    vatRegistered: pricing?.vatRegisteredSnapshot ?? rfq.selectedCompany?.vatRegistered,
    evidenceQuality: pricing?.evidenceQuality,
    complianceBlocking: compliance.blockingItems.map((b) => b.label),
    complianceComplete: rfq.complianceItems
      .filter((c) =>
        ["AVAILABLE", "COMPLETED", "VERIFIED", "NOT_REQUIRED"].includes(c.state),
      )
      .map((c) => c.label),
    nextAction: rfq.nextAction,
    nextActionReason: rfq.nextActionReason,
    pipelineStatus: rfq.status,
    emailTransport: "PENDING_EMAIL_INTEGRATION",
  });

  console.log(
    JSON.stringify(
      {
        REPORT: "BIDDIFY — FOUNDER REVIEW PREP",
        SEND_EXECUTED: false,
        AUTONOMOUS_SOURCING: "OFF",
        AUTONOMOUS_EMAIL: "OFF",
        AUTONOMOUS_SUBMISSION: "OFF",
        prepare: result,
        founderReviewPack: pack,
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
