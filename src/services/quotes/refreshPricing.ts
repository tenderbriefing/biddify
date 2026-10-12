/**
 * Versioned pricing refresh from verified supplier quotes + confirmed sourcing plan.
 */
import type { PrismaClient } from "@prisma/client";
import {
  recommendSourcingStrategy,
  type SystemSourcingRecommendation,
} from "@/domain/commercialComparison";
import { refreshPricingFromVerifiedQuotes } from "@/domain/pricingRefresh";
import { evaluateCommercialGate } from "@/domain/commercialGate";
import { writeAuditEvent } from "@/lib/audit";
import { isQuoteExpired } from "@/domain/commercialComparison";

export async function buildRecommendationForRfq(
  prisma: PrismaClient,
  rfqId: string,
): Promise<SystemSourcingRecommendation> {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
      quotes: {
        include: { lineItems: true, supplier: true },
      },
    },
  });
  if (!rfq) throw new Error("RFQ not found");

  const offers = rfq.quotes.flatMap((q) =>
    q.lineItems
      .filter((li) => li.rfqLineItemId)
      .map((li) => ({
        quoteId: q.id,
        quoteLineId: li.id,
        supplierId: q.supplierId,
        supplierName: q.supplier.name,
        rfqLineItemId: li.rfqLineItemId!,
        unitCost: li.unitCost != null ? Number(li.unitCost) : null,
        lineTotal: li.lineTotal != null ? Number(li.lineTotal) : null,
        brandSku: [li.brandOffered, li.sku].filter(Boolean).join(" / ") || null,
        matchState: li.matchState,
        evidenceType: q.evidenceType,
        verificationState: q.verificationState,
        deliveryCost: q.deliveryCost != null ? Number(q.deliveryCost) : null,
        deliveryKnown: q.deliveryKnown,
        quoteExpired: isQuoteExpired(q.validUntil),
      })),
  );

  return recommendSourcingStrategy({
    boq: rfq.lineItems.map((l) => ({
      id: l.id,
      quantity: Number(l.quantity),
    })),
    offers,
  });
}

export async function refreshRfqPricingFromVerifiedQuotes(
  prisma: PrismaClient,
  rfqId: string,
  options: {
    actorUserId?: string;
    actorEmail?: string;
    markupPercent?: number;
    confirmedRecommendation?: SystemSourcingRecommendation;
  },
) {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: {
      selectedCompany: true,
      pricingScenarios: {
        where: { isSelected: true },
        orderBy: { version: "desc" },
        take: 1,
      },
      lineItems: true,
    },
  });
  if (!rfq) throw new Error("RFQ not found");
  if (!rfq.selectedCompany) throw new Error("Bidding company required");

  const recommendation =
    options.confirmedRecommendation ??
    (await buildRecommendationForRfq(prisma, rfqId));

  if (recommendation.blockers.length && recommendation.lines.length === 0) {
    throw new Error(
      `Cannot refresh pricing: ${recommendation.blockers.join("; ")}`,
    );
  }

  const previous = rfq.pricingScenarios[0] ?? null;
  const markup =
    options.markupPercent ??
    (previous ? Number(previous.markupPercent) : 20);

  const refreshed = refreshPricingFromVerifiedQuotes({
    recommendation,
    markupPercent: markup,
    companyVatRegistered: rfq.selectedCompany.vatRegistered,
  });

  if (!refreshed.ok) {
    throw new Error(
      `Pricing refresh blocked: ${refreshed.blockers.join("; ")}`,
    );
  }

  const nextVersion = previous ? previous.version + 1 : 1;

  await prisma.pricingScenario.updateMany({
    where: { rfqId, isSelected: true },
    data: { isSelected: false },
  });

  const gate = evaluateCommercialGate({
    specificationsClear: true,
    lineItemsVerified: rfq.lineItems.every(
      (l) => l.verificationStatus === "VERIFIED",
    ),
    supplierIdentified: true,
    hasSupplierQuote: true,
    hasPriceEvidence: true,
    bestEvidenceType: "SUPPLIER_QUOTE",
    productsCompliant: "UNKNOWN",
    deliveryFeasible: refreshed.deliveryKnown ? true : "UNKNOWN",
    complianceFeasible: "UNKNOWN",
    workingCapitalIntensity: "MEDIUM",
    grossProfit: refreshed.grossProfit,
    grossMarginPercent: refreshed.grossMarginPercent,
    allPricesKnown: true,
    deliveryCostKnown: refreshed.deliveryKnown,
    realBiddingCompany: !rfq.selectedCompany.isDemo,
    companyCompliant: "UNKNOWN",
    vatTreatmentKnown: true,
    workingCapitalUnderstood: true,
  });

  const scenario = await prisma.pricingScenario.create({
    data: {
      rfqId,
      name: `Verified supplier v${nextVersion}`,
      version: nextVersion,
      previousScenarioId: previous?.id,
      pricingBasis: "VERIFIED_SUPPLIER",
      markupPercent: refreshed.markupPercent,
      supplierCostTotal: refreshed.supplierCost,
      deliveryCost: refreshed.delivery,
      landedCost: refreshed.landedCost,
      sellingPriceExVat: refreshed.sellingPriceExVat,
      vatAmount: refreshed.vatAmount,
      totalQuotation: refreshed.totalQuotation,
      grossProfit: refreshed.grossProfit,
      grossMarginPercent: refreshed.grossMarginPercent,
      workingCapitalRequired: refreshed.supplierCost,
      upfrontCashRequired: refreshed.supplierCost,
      evidenceQuality: "SUPPLIER_QUOTE",
      evidenceQuoteIds: JSON.stringify(refreshed.evidenceQuoteIds),
      profitabilityGate: gate.gate,
      profitabilityReasons: JSON.stringify(gate.reasons),
      vatRegisteredSnapshot: rfq.selectedCompany.vatRegistered,
      notes: `Refreshed from verified supplier quotes. ${recommendation.reason}`,
      isSelected: true,
      isDemo: false,
      lineItems: {
        create: recommendation.lines.map((l, idx) => {
          const boq = rfq.lineItems.find((b) => b.id === l.rfqLineItemId);
          const lineSell =
            Math.round(l.lineCost * (1 + markup / 100) * 100) / 100;
          return {
            rfqLineItemId: l.rfqLineItemId,
            description: boq?.description ?? `Line ${idx + 1}`,
            quantity: l.quantity,
            unitCost: l.unitCost,
            lineCost: l.lineCost,
            unitSell:
              l.quantity === 0
                ? 0
                : Math.round((lineSell / l.quantity) * 100) / 100,
            lineSell,
            supplierId: l.supplierId,
          };
        }),
      },
    },
  });

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      pricingBasis: "VERIFIED_SUPPLIER",
      profitabilityGate: gate.gate,
      // Invalidate commercials approval on material pricing change
      commercialsApprovedAt: null,
      commercialsApprovedBy: null,
    },
  });

  await writeAuditEvent({
    action: "PRICING_REFRESHED_FROM_SUPPLIER_QUOTE",
    entityType: "PricingScenario",
    entityId: scenario.id,
    userId: options.actorUserId,
    previousState: previous
      ? {
          landedCost: Number(previous.landedCost),
          totalQuotation: Number(previous.totalQuotation),
          pricingBasis: previous.pricingBasis,
          version: previous.version,
        }
      : null,
    newState: {
      landedCost: refreshed.landedCost,
      totalQuotation: refreshed.totalQuotation,
      markupPercent: refreshed.markupPercent,
      grossMarginPercent: refreshed.grossMarginPercent,
      pricingBasis: "VERIFIED_SUPPLIER",
      version: nextVersion,
      evidenceQuoteIds: refreshed.evidenceQuoteIds,
    },
    metadata: {
      actor: options.actorEmail,
      strategyType: recommendation.strategyType,
    },
  });

  return { scenario, refreshed, recommendation, previous };
}
