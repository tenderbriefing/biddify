/**
 * Autonomous RFQ Worker V1.
 * Prep ON / Submission OFF. One RFQ never blocks the queue.
 */

import { randomUUID } from "crypto";
import type {
  AutonomousOutcome,
  AutonomousProcessingState,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { writeAuditEvent } from "@/lib/audit";
import {
  CLAIM_TTL_MS,
  MAX_TRANSIENT_RETRIES,
  WORKER_VERSION,
  isRetryableFailure,
  outcomeFromState,
  type AutonomousProcessingState as DomainState,
} from "@/domain/autonomousStates";
import { classifySupplyAndDeliver } from "@/domain/supplyDeliverClassifier";
import { understandDocuments } from "@/domain/documentUnderstanding";
import { normalizeBoq } from "@/domain/boqNormalization";
import {
  EvidenceCatalogueProvider,
  type ResearchCandidate,
} from "@/domain/productResearch";
import { matchSpecification } from "@/domain/specificationMatching";
import { selectBestProductCandidate } from "@/domain/productSelection";
import { calculateLineLandedCost } from "@/domain/landedCostEngine";
import {
  buildLandedBreakdown,
  selectMarkupPolicy,
} from "@/domain/markupPolicy";
import {
  detectInternalDataLeakage,
  generateCustomerQuotation,
} from "@/domain/quotationGeneration";
import { classifyAutonomousOutcome } from "@/domain/autonomousOutcome";
import { evaluateCompanyEligibility } from "@/domain/companyEligibility";
import { calculatePricing } from "@/domain/pricing";
import { roundMoney, toNumber } from "@/domain/money";
import { LiveWebResearchProvider } from "@/services/research/liveWebProvider";
import type { LiveResearchEvent } from "@/services/research/liveWebProvider";
import { validateMultiSourcePrices } from "@/domain/multiSourcePricing";
import {
  assessDeliveryMateriality,
  type DeliveryEvidence,
} from "@/domain/deliveryEvidence";
import { classifyDeliveryV2 } from "@/domain/deliveryMaterialityV2";
import { buildRiskAllowances } from "@/domain/riskAllowance";
import {
  scoreLineResearchConfidence,
  overallSourcingConfidence,
} from "@/domain/researchConfidence";
import { mayAutoSelect } from "@/domain/specificationMatching";
import { RESEARCH_POLICY } from "@/domain/researchPolicy";
import {
  ageDaysFromRetrieved,
  freshnessBand,
  isUsableForAutonomousPricing,
} from "@/domain/researchPolicy";
import { reconcileQuantity } from "@/domain/quantityReconciliation";
import {
  extractPackSemantics,
  isFirmPackEvidence,
} from "@/domain/packExtraction";
import { isFirmPriceBasis } from "@/domain/priceBasis";
import { classifyPriceVariance } from "@/domain/priceVariancePolicy";
import { normalizeSupplierPriceForComparison } from "@/domain/vatNormalization";
import {
  buildLineWaterfall,
  buildRfqWaterfall,
} from "@/domain/costWaterfall";
import { evaluateCommercialIntegrity } from "@/domain/commercialIntegrity";
import { selectProcurementCost } from "@/domain/procurementCostStrategy";
import type { QuantityReconciliation } from "@/domain/quantityReconciliation";
import {
  aggregateOptimizerMetrics,
  optimizeLineProcurement,
  type LineOptimizerResult,
} from "@/domain/procurementOptimizer";
import {
  investigateExtremeVariance,
  reclassifyVarianceAfterInvestigation,
  varianceSecondSourceQueries,
} from "@/domain/varianceInvestigation";
import type { VarianceEvidenceSignal } from "@/domain/varianceInvestigation";
export type ProcessResult = {
  rfqId: string;
  internalId: string;
  outcome: AutonomousOutcome | "SKIPPED_LOCKED" | "PREP_DISABLED";
  state: AutonomousProcessingState | null;
  confidence: number | null;
  durationMs: number;
  reasons: string[];
  quotationNumber: string | null;
  webResearchCoverage?: number | null;
};

export type ProcessOptions = {
  /** Prefer live web only (no catalogue primary). Default true for V1 live research. */
  preferLiveWeb?: boolean;
  /** Include catalogue as fallback when live returns nothing. Default true. */
  catalogueFallback?: boolean;
  liveProviderFactory?: () => LiveWebResearchProvider;
};

type RunArtifacts = {
  classification?: unknown;
  documents?: unknown;
  boq?: unknown;
  research?: unknown;
  liveResearch?: unknown;
  matching?: unknown;
  selection?: unknown;
  multiSource?: unknown;
  pricing?: unknown;
  markup?: unknown;
  riskAllowance?: unknown;
  quotation?: unknown;
  outcome?: unknown;
  guardrails?: unknown;
  webResearchCoverage?: number;
  quantityReconciliations?: unknown;
  commercialIntegrity?: unknown;
  costWaterfall?: unknown;
  priceVariance?: unknown;
  integrityMetrics?: unknown;
  procurementOptimizer?: unknown;
  varianceInvestigation?: unknown;
  optimizerMetrics?: unknown;
};

async function transition(
  prisma: PrismaClient,
  rfqId: string,
  state: DomainState,
  extra: Record<string, unknown> = {},
) {
  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      autonomousState: state as AutonomousProcessingState,
      autonomousLastStep: state,
      ...extra,
    },
  });
}

/**
 * Idempotent claim: returns RFQ id or null.
 */
export async function claimNextRfq(
  prisma: PrismaClient,
  opts?: { preferInternalId?: string; now?: Date },
): Promise<{ id: string; claimToken: string } | null> {
  const now = opts?.now ?? new Date();
  const claimToken = randomUUID();
  const expires = new Date(now.getTime() + CLAIM_TTL_MS);

  const inFlightStates: AutonomousProcessingState[] = [
    "CLASSIFYING",
    "INGESTING_DOCUMENTS",
    "ANALYSING_REQUIREMENTS",
    "ELIGIBILITY_CHECK",
    "BOQ_EXTRACTION",
    "PRODUCT_RESEARCH",
    "PRODUCT_MATCHING",
    "PRICING",
    "QUOTATION_GENERATION",
    "COMPLIANCE_CHECK",
  ];

  const whereBase: Prisma.RfqWhereInput = {
    OR: [
      { autonomousState: null },
      { autonomousState: "DISCOVERED" },
      {
        AND: [
          { autonomousState: "FAILED" },
          { autonomousRetryCount: { lt: MAX_TRANSIENT_RETRIES } },
        ],
      },
      {
        AND: [
          { autonomousClaimExpiresAt: { lt: now } },
          { autonomousState: { in: inFlightStates } },
        ],
      },
    ],
  };

  const candidate = await prisma.rfq.findFirst({
    where: opts?.preferInternalId
      ? { AND: [{ internalId: opts.preferInternalId }, whereBase] }
      : {
          isRealSource: true,
          ...whereBase,
        },
    orderBy: { closingAt: "asc" },
    select: { id: true, autonomousClaimToken: true, autonomousClaimExpiresAt: true },
  });

  if (!candidate) return null;

  // Optimistic lock via claim token swap
  const updated = await prisma.rfq.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { autonomousClaimToken: null },
        { autonomousClaimExpiresAt: { lt: now } },
        { autonomousClaimToken: candidate.autonomousClaimToken },
      ],
    },
    data: {
      autonomousClaimToken: claimToken,
      autonomousClaimExpiresAt: expires,
      autonomousState: "CLASSIFYING",
      autonomousLastStep: "CLASSIFYING",
      autonomousStartedAt: now,
      autonomousWorkerVersion: WORKER_VERSION,
      autonomousFailureReason: null,
    },
  });

  if (updated.count === 0) return null;
  return { id: candidate.id, claimToken };
}

export async function processClaimedRfq(
  prisma: PrismaClient,
  rfqId: string,
  claimToken: string,
  processOpts: ProcessOptions = {},
): Promise<ProcessResult> {
  const preferLiveWeb = processOpts.preferLiveWeb !== false;
  const catalogueFallback = processOpts.catalogueFallback !== false;
  const started = Date.now();
  const settings = await prisma.systemSettings.findUnique({
    where: { id: "default" },
  });

  if (settings && settings.autonomousPrepEnabled === false) {
    return {
      rfqId,
      internalId: "?",
      outcome: "PREP_DISABLED",
      state: null,
      confidence: null,
      durationMs: Date.now() - started,
      reasons: ["autonomousPrepEnabled=false"],
      quotationNumber: null,
    };
  }

  if (settings?.autonomousSubmissionEnabled) {
    // Hard safety: never honour submission autonomy in V1 worker
    await prisma.systemSettings.update({
      where: { id: "default" },
      data: { autonomousSubmissionEnabled: false },
    });
  }

  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
      documents: true,
      requirements: true,
      quotes: {
        include: {
          lineItems: true,
          supplier: true,
        },
      },
      selectedCompany: true,
      pricingScenarios: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  if (!rfq || rfq.autonomousClaimToken !== claimToken) {
    return {
      rfqId,
      internalId: rfq?.internalId ?? "?",
      outcome: "SKIPPED_LOCKED",
      state: rfq?.autonomousState ?? null,
      confidence: null,
      durationMs: Date.now() - started,
      reasons: ["Claim token mismatch — duplicate processing prevented"],
      quotationNumber: null,
    };
  }

  const artifacts: RunArtifacts = {};
  const reasons: string[] = [];

  try {
    await writeAuditEvent(
      {
        action: "AUTONOMOUS_PROCESSING_STARTED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: { worker: WORKER_VERSION, internalId: rfq.internalId },
      },
      prisma,
    );

    // —— CLASSIFY ——
    await transition(prisma, rfq.id, "CLASSIFYING");
    const docHints = rfq.documents
      .map((d) => d.extractedText)
      .filter(Boolean) as string[];
    const classification = classifySupplyAndDeliver({
      title: rfq.title,
      description: rfq.description,
      category: rfq.category,
      boqLineCount: rfq.lineItems.length,
      hasPricingSchedule: rfq.lineItems.length > 0,
      documentTextHints: docHints.slice(0, 3).map((t) => t.slice(0, 2000)),
      hasServiceLanguageInDocs: docHints.some((t) =>
        /provision of services|maintenance contract/i.test(t),
      ),
      hasConstructionLanguageInDocs: docHints.some((t) =>
        /cidb|construction works/i.test(t),
      ),
    });
    artifacts.classification = classification;

    await prisma.rfq.update({
      where: { id: rfq.id },
      data: {
        classification: classification.opportunityClass,
        classificationConfidence: classification.confidence,
        classificationReasoning: classification.reason,
        classificationSource: "HEURISTIC",
      },
    });

    await writeAuditEvent(
      {
        action: "RFQ_CLASSIFIED",
        entityType: "Rfq",
        entityId: rfq.id,
        newState: classification,
      },
      prisma,
    );

    if (!classification.proceedsAutomatically) {
      if (
        classification.classification === "MIXED" ||
        classification.classification === "UNKNOWN"
      ) {
        return await finalize(prisma, rfq, {
          state: "REVIEW_REQUIRED",
          outcome: "REVIEW_REQUIRED",
          confidence: classification.confidence,
          reasons: [classification.reason],
          artifacts,
          started,
        });
      }
      return await finalize(prisma, rfq, {
        state: "NOT_SUPPLY_AND_DELIVER",
        outcome: "SKIPPED_NOT_SUPPLY",
        confidence: classification.confidence,
        reasons: [classification.reason],
        artifacts,
        started,
      });
    }

    // —— DOCUMENTS ——
    await transition(prisma, rfq.id, "INGESTING_DOCUMENTS");
    await transition(prisma, rfq.id, "ANALYSING_REQUIREMENTS");
    const understanding = understandDocuments({
      title: rfq.title,
      description: rfq.description,
      tenderNumber: rfq.tenderNumber,
      buyer: rfq.buyer,
      closingAt: rfq.closingAt,
      closingTimeKnown: rfq.closingTimeKnown,
      deliveryAddress: rfq.deliveryAddress,
      deliveryPeriod: rfq.deliveryPeriod,
      briefingDate: rfq.briefingDate,
      briefingCompulsory: rfq.briefingCompulsory,
      briefingCompulsoryKnown: rfq.briefingCompulsoryKnown,
      paymentTerms: rfq.paymentTerms,
      documentTexts: rfq.documents.map((d) => ({
        fileName: d.fileName,
        text: d.extractedText,
      })),
      existingRequirements: rfq.requirements.map((r) => ({
        category: r.category,
        description: r.description,
        isMandatory: r.isMandatory,
      })),
    });
    artifacts.documents = understanding;
    await writeAuditEvent(
      {
        action: "RFQ_DOCUMENTS_ANALYSED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: {
          confidence: understanding.overallConfidence,
          warnings: understanding.warnings,
        },
      },
      prisma,
    );

    // —— ELIGIBILITY ——
    await transition(prisma, rfq.id, "ELIGIBILITY_CHECK");
    let eligibilityVerdict:
      | "ELIGIBLE"
      | "ELIGIBLE_WITH_WARNING"
      | "NOT_ELIGIBLE"
      | "UNRESOLVED" = "UNRESOLVED";

    if (!rfq.selectedCompany) {
      eligibilityVerdict = "UNRESOLVED";
      reasons.push("No selected company — eligibility unresolved");
    } else {
      const elig = evaluateCompanyEligibility({
        rfqInternalId: rfq.internalId,
        companyLegalName: rfq.selectedCompany.legalName,
        rfqRequiresCsd: understanding.csdRequirements.length > 0 || true,
        companyHasActiveCsd: Boolean(rfq.selectedCompany.csdNumber),
        rfqRequiresCompulsoryBriefing:
          rfq.briefingCompulsoryKnown && rfq.briefingCompulsory,
        briefingAttendedOrNotApplicable:
          !(rfq.briefingCompulsoryKnown && rfq.briefingCompulsory),
        rfqStatesCommodityRestriction: false,
        companyCsdCommodityMatchesRfq: "UNKNOWN",
        rfqRequiresSpecialLicence: false,
        companyHasRequiredLicence: "NOT_APPLICABLE",
        companyRestrictedOnCsd: false,
        companyTaxCompliant: "UNKNOWN",
      });
      eligibilityVerdict = elig.verdict;
      if (elig.blockers.length) reasons.push(...elig.blockers);
      if (elig.warnings.length) reasons.push(...elig.warnings);
    }

    const closingPassed = rfq.closingAt.getTime() < Date.now();
    const briefingMissed =
      rfq.briefingCompulsoryKnown &&
      rfq.briefingCompulsory &&
      rfq.briefingDate != null &&
      rfq.briefingDate.getTime() < Date.now();

    // —— BOQ ——
    await transition(prisma, rfq.id, "BOQ_EXTRACTION");
    const normalized = normalizeBoq(
      rfq.lineItems.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        specification: l.specification,
        brandRequirement: l.brandRequirement ?? l.brand,
        model: l.model,
        quantity: toNumber(Number(l.quantity)),
        unit: l.unit,
        equivalentAllowed: l.equivalentAllowed,
        mandatoryCharacteristics: l.mandatoryCharacteristics,
        deliveryDestination: l.deliveryDestination,
        notes: l.notes,
      })),
    );
    artifacts.boq = normalized;
    await writeAuditEvent(
      {
        action: "BOQ_NORMALIZED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: { lineCount: normalized.length },
      },
      prisma,
    );

    if (normalized.length === 0) {
      return await finalize(prisma, rfq, {
        state: "UNPRICEABLE",
        outcome: "UNPRICEABLE",
        confidence: 0.2,
        reasons: ["No BOQ lines to price"],
        artifacts,
        started,
      });
    }

    // —— LIVE WEB RESEARCH (catalogue is fallback only) ——
    await transition(prisma, rfq.id, "PRODUCT_RESEARCH");
    await prisma.productResearchCandidate.deleteMany({ where: { rfqId: rfq.id } });
    await prisma.researchObservation.deleteMany({ where: { rfqId: rfq.id } });

    const researchEvents: LiveResearchEvent[] = [];
    const liveProvider =
      processOpts.liveProviderFactory?.() ??
      new LiveWebResearchProvider({
        onEvent: (e) => {
          researchEvents.push(e);
        },
      });

    const legacyEvidence = rfq.quotes.flatMap((q) =>
      q.lineItems.map((li) => ({
        supplierName: q.supplier.name,
        evidenceType: q.evidenceType,
        description: li.description,
        brandOffered: li.brandOffered,
        modelOffered: li.modelOffered,
        sku: li.sku,
        unitCost: li.unitCost != null ? toNumber(Number(li.unitCost)) : null,
        priceKnown: li.priceKnown,
        quantity: toNumber(Number(li.quantity)),
        unit: li.unit,
        availability: li.availability,
        sourceReference: q.sourceReference,
        sourceDocumentPath: q.sourceDocumentPath,
        quoteDate: q.quoteDate,
        receivedAt: q.receivedAt,
        deliveryCost:
          q.deliveryCost != null ? toNumber(Number(q.deliveryCost)) : null,
        deliveryKnown: q.deliveryKnown,
        vatIncluded: q.vatIncluded,
        lineNumber: li.rfqLineItemId
          ? rfq.lineItems.find((x) => x.id === li.rfqLineItemId)?.lineNumber
          : null,
        rfqLineItemId: li.rfqLineItemId,
      })),
    );
    const catalogue = new EvidenceCatalogueProvider(legacyEvidence);

    await writeAuditEvent(
      {
        action: "LIVE_RESEARCH_STARTED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: { preferLiveWeb, catalogueFallback },
      },
      prisma,
    );

    const researchByLine: Record<
      number,
      { candidates: ResearchCandidate[]; lineItemId: string; liveCount: number }
    > = {};

    let linesWithLivePricing = 0;

    for (const line of normalized) {
      const lineItem = rfq.lineItems.find((l) => l.lineNumber === line.lineNumber)!;
      let candidates: ResearchCandidate[] = [];
      try {
        if (preferLiveWeb) {
          candidates = await liveProvider.search({
            lineNumber: line.lineNumber,
            description: line.description,
            brandRequirement: line.brandRequirement,
            modelRequirement: line.modelRequirement,
            quantity: line.quantity,
            unit: line.unit,
            technicalSpecifications: line.technicalSpecifications,
          });
        }
      } catch (err) {
        reasons.push(
          `Line ${line.lineNumber}: live research isolated failure — ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const liveCount = candidates.filter((c) => c.priceKnown).length;
      if (liveCount > 0) linesWithLivePricing += 1;

      if (catalogueFallback && candidates.filter((c) => c.priceKnown).length === 0) {
        const fallback = await catalogue.search({
          lineNumber: line.lineNumber,
          description: line.description,
          brandRequirement: line.brandRequirement,
          modelRequirement: line.modelRequirement,
          quantity: line.quantity,
          unit: line.unit,
          technicalSpecifications: line.technicalSpecifications,
        });
        candidates = [
          ...candidates,
          ...fallback.map((c) => ({
            ...c,
            rawEvidence: { ...c.rawEvidence, fallback: "evidence-catalogue" },
          })),
        ];
      }

      // Procurement Optimizer: second-pass research when below target candidates
      // or battery lines needing explicit pack evidence (never infer pack size).
      const needsMore =
        RESEARCH_POLICY.optimizer.enabled &&
        (/battery|aaa|aa\b/i.test(line.description) ||
          candidates.filter((c) => c.priceKnown).length <
            RESEARCH_POLICY.budget.minCandidatesTargetPerLine);

      if (needsMore && preferLiveWeb) {
        await writeAuditEvent(
          {
            action: "PROCUREMENT_RESEARCH_STARTED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              reason: "second-pass for pack/multi-candidate discovery",
            },
          },
          prisma,
        );
        try {
          const isBattery = /battery|aaa|\baa\b/i.test(line.description);
          const size = /\baaa\b/i.test(line.description)
            ? "AAA"
            : /\baa\b/i.test(line.description)
              ? "AA"
              : "";
          const brand = line.brandRequirement ?? (isBattery ? "Duracell" : "");
          const shortQueries = isBattery
            ? [
                `${brand} ${size} pack of 4`.trim(),
                `${brand} ${size} pack of 8`.trim(),
                `${brand} ${size} pack of 10`.trim(),
                `${brand} ${size} alkaline battery pack`.trim(),
                `Energizer ${size} pack`.trim(),
              ].filter((q) => q.length > 3)
            : varianceSecondSourceQueries({
                description: line.description,
                brand: line.brandRequirement,
                suspectedPack: true,
              });

          const extra = await liveProvider.catalogueQuickSearch(
            line.lineNumber,
            shortQueries.slice(
              0,
              RESEARCH_POLICY.budget.maxSecondSourceVarianceSearches + 1,
            ),
          );
          const seen = new Set(
            candidates
              .map((c) => c.productUrl?.split("?")[0]?.toLowerCase())
              .filter(Boolean),
          );
          for (const c of extra) {
            const key = c.productUrl?.split("?")[0]?.toLowerCase();
            if (key && seen.has(key)) continue;
            if (key) seen.add(key);
            // Battery chemistry/size gate — reject wrong cell size
            if (isBattery && size) {
              const title = c.productName.toLowerCase();
              if (size === "AAA" && !/\baaa\b/.test(title)) continue;
              if (size === "AA" && (!/\baa\b/.test(title) || /\baaa\b/.test(title)))
                continue;
            }
            candidates.push({
              ...c,
              rawEvidence: {
                ...c.rawEvidence,
                secondSource: true,
              },
            });
            await writeAuditEvent(
              {
                action: "PROCUREMENT_CANDIDATE_FOUND",
                entityType: "Rfq",
                entityId: rfq.id,
                metadata: {
                  lineNumber: line.lineNumber,
                  product: c.productName,
                  price: c.price,
                  packSize: c.packSize,
                },
              },
              prisma,
            );
          }
        } catch (err) {
          reasons.push(
            `Line ${line.lineNumber}: second-pass research isolated — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      researchByLine[line.lineNumber] = {
        candidates,
        lineItemId: lineItem.id,
        liveCount: candidates.filter((c) => c.priceKnown).length,
      };
      if (researchByLine[line.lineNumber].liveCount > 0 && liveCount === 0) {
        linesWithLivePricing += 1;
      }
    }

    // Persist granular research observations (dedupe by unique key)
    for (const ev of researchEvents) {
      try {
        if (ev.type === "SEARCH_QUERY_GENERATED") {
          await prisma.researchObservation.create({
            data: {
              rfqId: rfq.id,
              rfqLineItemId: researchByLine[ev.lineNumber]?.lineItemId,
              eventType: ev.type,
              queryText: ev.query.query,
              payloadJson: JSON.stringify(ev.query),
            },
          });
        } else if (
          ev.type === "PRODUCT_SOURCE_DISCOVERED" ||
          ev.type === "PRODUCT_PAGE_INSPECTED" ||
          ev.type === "PRODUCT_PRICE_OBSERVED" ||
          ev.type === "PRODUCT_SPEC_OBSERVED" ||
          ev.type === "PRODUCT_CANDIDATE_REJECTED"
        ) {
          const url =
            "hit" in ev
              ? ev.hit.url
              : "page" in ev
                ? ev.page.finalUrl
                : "url" in ev
                  ? ev.url
                  : null;
          if (!url) continue;
          const lineItemId = researchByLine[ev.lineNumber]?.lineItemId ?? null;
          const existing = await prisma.researchObservation.findFirst({
            where: {
              rfqId: rfq.id,
              rfqLineItemId: lineItemId,
              sourceUrl: url,
              eventType: ev.type,
            },
          });
          if (existing) {
            await prisma.researchObservation.update({
              where: { id: existing.id },
              data: {
                payloadJson: JSON.stringify(ev),
                retrievedAt: new Date(),
              },
            });
          } else {
            await prisma.researchObservation.create({
              data: {
                rfqId: rfq.id,
                rfqLineItemId: lineItemId,
                eventType: ev.type,
                sourceUrl: url,
                domain: (() => {
                  try {
                    return new URL(url).hostname;
                  } catch {
                    return null;
                  }
                })(),
                payloadJson: JSON.stringify(ev),
              },
            });
          }
        }
      } catch {
        // Observation persistence must not crash the worker
      }
    }

    const webResearchCoverage =
      normalized.length === 0 ? 0 : linesWithLivePricing / normalized.length;
    artifacts.webResearchCoverage = webResearchCoverage;
    artifacts.liveResearch = {
      events: researchEvents.length,
      fetchCount: liveProvider.fetchCount,
      metricsByLine: Object.fromEntries(liveProvider.metricsByLine),
      coverage: webResearchCoverage,
    };
    artifacts.research = Object.fromEntries(
      Object.entries(researchByLine).map(([k, v]) => [
        k,
        v.candidates.map((c) => ({
          source: c.sourceName,
          product: c.productName,
          url: c.productUrl,
          price: c.price,
          evidenceLevel: c.evidenceLevel,
          provider: c.rawEvidence?.provider ?? "unknown",
        })),
      ]),
    );

    await writeAuditEvent(
      {
        action: "LIVE_RESEARCH_COMPLETED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: {
          lines: Object.keys(researchByLine).length,
          candidateCount: Object.values(researchByLine).reduce(
            (s, v) => s + v.candidates.length,
            0,
          ),
          webResearchCoverage,
          fetches: liveProvider.fetchCount,
        },
      },
      prisma,
    );
    await writeAuditEvent(
      {
        action: "PRODUCT_RESEARCH_COMPLETED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: {
          lines: Object.keys(researchByLine).length,
          candidateCount: Object.values(researchByLine).reduce(
            (s, v) => s + v.candidates.length,
            0,
          ),
          preferLiveWeb,
        },
      },
      prisma,
    );

    // —— MATCH + SELECT ——
    await transition(prisma, rfq.id, "PRODUCT_MATCHING");
    const matchArtifacts: unknown[] = [];
    const selectionArtifacts: unknown[] = [];
    const guardrailLines: Parameters<
      typeof classifyAutonomousOutcome
    >[0]["lines"] = [];

    type PricedLine = {
      lineNumber: number;
      description: string;
      quantity: number;
      unit: string;
      unitCost: number;
      unitSell: number;
      lineSell: number;
      productCost: number;
      flags: string[];
      unresolved: boolean;
      evidenceLevel: string;
      matchVerdict: string;
      candidateId: string | null;
      reconciliation?: QuantityReconciliation | null;
    };

    const pricedLines: PricedLine[] = [];
    const integrityLines: Parameters<
      typeof evaluateCommercialIntegrity
    >[0]["lines"] = [];
    const reconciliations: QuantityReconciliation[] = [];
    const optimizerResults: LineOptimizerResult[] = [];
    let totalProductCost = 0;
    let anyDeliveryKnown = false;
    let deliveryTotal = 0;
    let deliveryAllowanceTotal = 0;
    let packAmbiguity = false;
    let evidenceWeak = false;
    let vatAcceptable = true;
    let deliveryV2Blocks = false;
    let deliveryV2Summary: ReturnType<typeof classifyDeliveryV2> | null = null;
    let potentialSavings = 0;

    for (const line of normalized) {
      const { candidates, lineItemId } = researchByLine[line.lineNumber];
      const scoredInputs = [];
      const persistedIds: string[] = [];

      for (const c of candidates) {
        const match = matchSpecification({
          requiredDescription: line.originalWording,
          requiredBrand: line.brandRequirement,
          requiredModel: line.modelRequirement,
          requiredAttributes: line.mandatoryAttributes,
          equivalentAllowed: line.equivalentAllowed,
          candidateDescription: c.productName,
          candidateBrand: c.brand,
          candidateModel: c.modelSku,
          candidateSpecText: null,
        });
        matchArtifacts.push({
          line: line.lineNumber,
          product: c.productName,
          ...match,
        });

        const packExtract = extractPackSemantics({
          productName: c.productName,
          description: String(c.rawEvidence?.description ?? ""),
          tenderUnit: line.unit,
          explicitPackSize: c.packSize,
        });
        const previewRecon =
          c.priceKnown && c.price != null
            ? reconcileQuantity({
                tenderQuantity: line.quantity,
                tenderUnit: line.unit,
                productName: c.productName,
                productDescription: String(c.rawEvidence?.description ?? ""),
                observedSupplierPrice: c.price,
                explicitPackSize: c.packSize,
              })
            : null;
        const effectiveFromRecon =
          previewRecon?.effectiveTenderUnitCost ?? c.effectiveUnitCost;
        const packCalc = previewRecon ?? c.rawEvidence?.packCalculation ?? null;
        const deliveryEv = c.rawEvidence?.delivery ?? null;
        const sourceQuality =
          typeof c.rawEvidence?.sourceQuality === "number"
            ? c.rawEvidence.sourceQuality
            : c.sourceName.toLowerCase().includes("makro")
              ? 0.88
              : 0.55;

        const row = await prisma.productResearchCandidate.create({
          data: {
            rfqId: rfq.id,
            rfqLineItemId: lineItemId,
            sourceName: c.sourceName,
            sourceType: c.sourceType,
            productName: c.productName,
            brand: c.brand,
            modelSku: c.modelSku,
            productUrl: c.productUrl,
            price: c.price,
            priceKnown: c.priceKnown,
            vatTreatment: c.vatTreatment,
            packSize: packExtract.packSize ?? c.packSize,
            packUnit: packExtract.supplierSellingUnit,
            effectiveUnitCost: effectiveFromRecon,
            availability: c.availability,
            deliveryCost: c.deliveryCost,
            deliveryKnown: c.deliveryKnown,
            evidenceLevel: c.evidenceLevel,
            retrievedAt: c.retrievedAt,
            evidenceAgeHours: c.evidenceAgeHours,
            rawEvidenceJson: JSON.stringify({
              ...c.rawEvidence,
              packExtraction: packExtract,
              quantityReconciliation: previewRecon,
            }),
            matchVerdict: match.verdict,
            matchConfidence: match.confidence,
            matchReasoning: match.reasoning,
            matchedAttributes: JSON.stringify(match.matchedAttributes),
            missingAttributes: JSON.stringify(match.missingAttributes),
            conflictingAttributes: JSON.stringify(match.conflictingAttributes),
            attributeComparisonsJson: JSON.stringify(
              match.attributeComparisons ?? [],
            ),
            researchProvider: String(c.rawEvidence?.provider ?? "unknown"),
            sourceQuality,
            priceType: String(
              c.rawEvidence?.priceType ?? packExtract.priceUnit ?? null,
            ),
            packCalculationJson: packCalc ? JSON.stringify(packCalc) : null,
            deliveryJson: deliveryEv ? JSON.stringify(deliveryEv) : null,
            selectionStatus: "ALTERNATIVE",
          },
        });
        persistedIds.push(row.id);

        scoredInputs.push({
          id: row.id,
          matchVerdict: match.verdict,
          matchConfidence: match.confidence,
          evidenceLevel: c.evidenceLevel,
          evidenceAgeHours: c.evidenceAgeHours,
          effectiveUnitCost: effectiveFromRecon,
          priceKnown: Boolean(c.priceKnown && c.price != null),
          availabilityKnown: Boolean(c.availability),
          packSizeCorrect: isFirmPackEvidence(packExtract),
          deliveryKnown: c.deliveryKnown,
          sourceCredibility: sourceQuality,
          firmRecon: Boolean(previewRecon?.firm),
          _candidate: c,
          _match: match,
          _packExtract: packExtract,
          _previewRecon: previewRecon,
        });
      }

      await writeAuditEvent(
        {
          action: "PRODUCT_MATCH_EVALUATED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: { lineNumber: line.lineNumber, candidates: candidates.length },
        },
        prisma,
      );

      const firmForCompare = scoredInputs.filter(
        (s) => s.priceKnown && s.effectiveUnitCost != null && s.firmRecon,
      );
      const multi = validateMultiSourcePrices(
        (firmForCompare.length > 0 ? firmForCompare : scoredInputs.filter(
          (s) => s.priceKnown && s.effectiveUnitCost != null,
        )).map((s) => ({
          id: s.id,
          price: s.effectiveUnitCost as number,
          sourceQuality: s.sourceCredibility,
          matchSelectable: mayAutoSelect(s.matchVerdict),
          freshnessOk: isUsableForAutonomousPricing(
            freshnessBand(
              ageDaysFromRetrieved(s._candidate.retrievedAt, new Date()),
            ),
          ),
          packResolved: s.packSizeCorrect,
          flags: s.sourceCredibility < 0.4 ? ["WEAK_SOURCE"] : undefined,
        })),
        {
          highValueLine:
            (scoredInputs[0]?.effectiveUnitCost ?? 0) * line.quantity >=
            RESEARCH_POLICY.multiSource.highValueLineThresholdZar,
        },
      );

      const costPick = selectProcurementCost(
        scoredInputs
          .filter((s) => s.firmRecon && s.effectiveUnitCost != null)
          .map((s) => ({
            id: s.id,
            effectiveUnitCost: s.effectiveUnitCost as number,
            sourceQuality: s.sourceCredibility,
            firm: true,
          })),
        {
          highConfidence: scoredInputs.some(
            (s) => s.sourceCredibility >= 0.7 && s.firmRecon,
          ),
          highDispersion:
            multi.dispersionCv != null && multi.dispersionCv >= 0.35,
        },
      );

      const selection = selectBestProductCandidate(
        scoredInputs.map((s) => ({
          id: s.id,
          matchVerdict: s.matchVerdict,
          matchConfidence: s.matchConfidence,
          evidenceLevel: s.evidenceLevel,
          evidenceAgeHours: s.evidenceAgeHours,
          effectiveUnitCost: s.effectiveUnitCost,
          priceKnown: s.priceKnown,
          availabilityKnown: s.availabilityKnown,
          packSizeCorrect: s.packSizeCorrect,
          deliveryKnown: s.deliveryKnown,
          sourceCredibility: s.sourceCredibility,
        })),
      );

      // —— PROCUREMENT OPTIMIZER V1 ——
      const optResult = optimizeLineProcurement({
        lineNumber: line.lineNumber,
        description: line.originalWording,
        tenderQuantity: line.quantity,
        tenderUnit: line.unit,
        brandRequirement: line.brandRequirement,
        modelRequirement: line.modelRequirement,
        equivalentAllowed: line.equivalentAllowed,
        technicalSpecifications: line.technicalSpecifications,
        candidates: scoredInputs.map((s) => ({
          id: s.id,
          supplier: s._candidate.sourceName,
          sourceUrl: s._candidate.productUrl,
          sourceType: s._candidate.sourceType,
          productTitle: s._candidate.productName,
          brand: s._candidate.brand,
          sku: s._candidate.modelSku,
          productDescription: String(s._candidate.rawEvidence?.description ?? ""),
          displayedPrice: s._candidate.price,
          priceKnown: s._candidate.priceKnown,
          vatTreatment: s._candidate.vatTreatment,
          packSize: s._candidate.packSize,
          availability: s._candidate.availability,
          delivery: (s._candidate.rawEvidence?.delivery ?? null) as
            | import("@/domain/deliveryEvidence").DeliveryEvidence
            | null,
          sourceQuality: s.sourceCredibility,
          retrievedAt: s._candidate.retrievedAt,
        })),
        splitAllowed: RESEARCH_POLICY.optimizer.allowSplitSupplier,
      });
      optimizerResults.push(optResult);
      if (optResult.strategy.savingsVsFirstValid != null) {
        potentialSavings += Math.max(0, optResult.strategy.savingsVsFirstValid);
      }

      await writeAuditEvent(
        {
          action: "PROCUREMENT_STRATEGY_OPTIMIZED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: {
            lineNumber: line.lineNumber,
            type: optResult.strategy.type,
            totalLanded: optResult.strategy.totalLandedCost,
            usable: optResult.metrics.commerciallyUsable,
          },
        },
        prisma,
      );
      if (optResult.strategy.type === "SPLIT_SUPPLIER") {
        await writeAuditEvent(
          {
            action: "PROCUREMENT_SPLIT_SELECTED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              allocations: optResult.strategy.allocations,
            },
          },
          prisma,
        );
      } else if (optResult.recommendedCandidateId) {
        await writeAuditEvent(
          {
            action: "PROCUREMENT_WINNER_SELECTED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              winnerId: optResult.recommendedCandidateId,
              reason: optResult.winnerReason,
            },
          },
          prisma,
        );
      } else {
        await writeAuditEvent(
          {
            action: "PROCUREMENT_OPTIMIZATION_BLOCKED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              type: optResult.strategy.type,
              blocked: optResult.strategy.blockedReasons,
            },
          },
          prisma,
        );
      }

      // Persist optimizer snapshot on each candidate row
      for (const pc of optResult.candidates) {
        try {
          await prisma.productResearchCandidate.update({
            where: { id: pc.id },
            data: {
              notes: JSON.stringify({
                optimizer: {
                  rank: optResult.ranked.find((r) => r.candidate.id === pc.id)
                    ?.rank,
                  spec: pc.specification.classification,
                  stock: pc.stock.class,
                  landed: pc.landedProcurementCost,
                  integrityFirm: pc.commercialIntegrityFirm,
                  flags: pc.integrityFlags,
                },
              }),
            },
          });
        } catch {
          /* candidate may be soft-only */
        }
      }

      selectionArtifacts.push({
        line: line.lineNumber,
        ...selection,
        multiSource: multi,
        optimizer: {
          strategy: optResult.strategy,
          recommended: optResult.recommendedCandidateId,
          reason: optResult.winnerReason,
          metrics: optResult.metrics,
        },
      });

      let selectedCandidate: ResearchCandidate | null = null;
      // Prefer optimizer winner (lowest defensible landed among integrity-firm)
      let selectedId: string | null =
        optResult.strategy.type === "SPLIT_SUPPLIER"
          ? optResult.strategy.allocations[0]?.candidateId ?? null
          : optResult.recommendedCandidateId;

      if (
        !selectedId ||
        !mayAutoSelect(
          scoredInputs.find((s) => s.id === selectedId)?.matchVerdict ??
            "INSUFFICIENT_INFORMATION",
        )
      ) {
        selectedId =
          costPick.selectedId &&
          mayAutoSelect(
            scoredInputs.find((s) => s.id === costPick.selectedId)
              ?.matchVerdict ?? "INSUFFICIENT_INFORMATION",
          )
            ? costPick.selectedId
            : multi.selectedId &&
                mayAutoSelect(
                  scoredInputs.find((s) => s.id === multi.selectedId)
                    ?.matchVerdict ?? "INSUFFICIENT_INFORMATION",
                )
              ? multi.selectedId
              : selection.selectedId;
      }

      if (!selectedId) {
        const soft = scoredInputs
          .filter(
            (s) =>
              s.priceKnown &&
              s.effectiveUnitCost != null &&
              s.matchVerdict !== "MISMATCH",
          )
          .sort(
            (a, b) =>
              Number(b.firmRecon) - Number(a.firmRecon) ||
              (b.matchConfidence || 0) - (a.matchConfidence || 0) ||
              (a.effectiveUnitCost ?? 9999) - (b.effectiveUnitCost ?? 9999),
          )[0];
        if (soft) {
          selectedId = soft.id;
          selectedCandidate = soft._candidate;
          evidenceWeak = true;
        }
      } else {
        selectedCandidate =
          scoredInputs.find((s) => s.id === selectedId)?._candidate ?? null;
      }

      if (selectedId) {
        await prisma.productResearchCandidate.update({
          where: { id: selectedId },
          data: {
            selected: true,
            selectionStatus: selection.selectedId === selectedId || multi.selectedId === selectedId
              ? "SELECTED"
              : "SELECTED",
            selectionReason: selection.reason,
          },
        });
        for (const alt of multi.alternatives) {
          await prisma.productResearchCandidate.updateMany({
            where: { id: alt },
            data: { selectionStatus: "ALTERNATIVE" },
          });
        }
        for (const rej of multi.rejected) {
          await prisma.productResearchCandidate.updateMany({
            where: { id: rej.id },
            data: {
              selectionStatus: "REJECTED",
              selectionReason: rej.reason,
            },
          });
        }
        await writeAuditEvent(
          {
            action: "PRODUCT_CANDIDATE_SELECTED",
            entityType: "ProductResearchCandidate",
            entityId: selectedId,
            metadata: { lineNumber: line.lineNumber, reason: selection.reason },
          },
          prisma,
        );
        await writeAuditEvent(
          {
            action: "PRODUCT_SELECTED",
            entityType: "ProductResearchCandidate",
            entityId: selectedId,
            metadata: { lineNumber: line.lineNumber, reason: selection.reason },
          },
          prisma,
        );
        await writeAuditEvent(
          {
            action: "MULTI_SOURCE_PRICE_VALIDATED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: { lineNumber: line.lineNumber, ...multi },
          },
          prisma,
        );
      }

      const selectedScored = scoredInputs.find((s) => s.id === selectedId);
      const recon: QuantityReconciliation | null =
        selectedCandidate && selectedCandidate.price != null
          ? reconcileQuantity({
              tenderQuantity: line.quantity,
              tenderUnit: line.unit,
              productName: selectedCandidate.productName,
              productDescription: String(
                selectedCandidate.rawEvidence?.description ?? "",
              ),
              observedSupplierPrice: selectedCandidate.price,
              explicitPackSize: selectedCandidate.packSize,
            })
          : selectedScored?._previewRecon ?? null;

      if (recon) {
        reconciliations.push(recon);
        await writeAuditEvent(
          {
            action: "QUANTITY_RECONCILED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              firm: recon.firm,
              packsRequired: recon.packsRequired,
              procurementCost: recon.procurementCost,
              humanReadable: recon.humanReadable,
            },
          },
          prisma,
        );
        await writeAuditEvent(
          {
            action: "PACK_SIZE_NORMALIZED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              pack: recon.packExtraction,
            },
          },
          prisma,
        );
        await writeAuditEvent(
          {
            action: "PRICE_BASIS_NORMALIZED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: {
              lineNumber: line.lineNumber,
              basis: recon.supplierPriceBasis,
            },
          },
          prisma,
        );
      }

      if (selectedId && recon) {
        await prisma.productResearchCandidate.update({
          where: { id: selectedId },
          data: {
            packCalculationJson: JSON.stringify(recon),
            packSize: recon.supplierPackSize,
            packUnit: recon.supplierSellingUnit,
            effectiveUnitCost: recon.effectiveTenderUnitCost,
            selectionReason: [
              selectedScored
                ? selection.reason
                : null,
              costPick.reason,
              recon.reasoning,
            ]
              .filter(Boolean)
              .join(" | "),
          },
        });
      }

      const unitCost = recon?.effectiveTenderUnitCost ?? selectedCandidate?.effectiveUnitCost ?? null;
      const priceKnown = Boolean(
        selectedCandidate?.priceKnown &&
          recon?.firm &&
          recon.procurementCost != null,
      );
      const deliveryEv = (selectedCandidate?.rawEvidence?.delivery ?? {
        type: "UNKNOWN_DELIVERY",
        amount: null,
        threshold: null,
        destinationAssumption: null,
        source: null,
        known: false,
        notes: [],
      }) as DeliveryEvidence;

      const productCostFromRecon = recon?.firm
        ? (recon.procurementCost ?? 0)
        : 0;

      const landed = calculateLineLandedCost({
        tenderQuantity: line.quantity,
        unitCost: recon?.firm ? unitCost : null,
        priceKnown,
        deliveryKnown: deliveryEv.known === true,
        deliveryCost: deliveryEv.known ? deliveryEv.amount : null,
        vatTreatmentKnown:
          selectedCandidate?.vatTreatment !== "UNKNOWN" &&
          selectedCandidate?.vatTreatment != null,
        availabilityKnown: Boolean(selectedCandidate?.availability),
        supplierPackSize: recon?.supplierPackSize,
        packPrice:
          recon?.supplierPackSize &&
          recon.supplierPackSize > 1 &&
          selectedCandidate?.price != null
            ? selectedCandidate.price
            : null,
      });

      // Prefer quantity-reconciled procurement cost when firm
      if (recon?.firm && recon.procurementCost != null) {
        landed.productCost = recon.procurementCost;
        landed.packsRequired = recon.packsRequired;
        landed.unresolved = false;
      } else if (recon && !recon.firm) {
        landed.unresolved = true;
        landed.productCost = 0;
        landed.flags.push("PACK_SIZE_AMBIGUITY");
        packAmbiguity = true;
      }

      if (landed.flags.includes("PACK_SIZE_AMBIGUITY")) packAmbiguity = true;

      const lineDeliveryV2 = classifyDeliveryV2({
        delivery: deliveryEv,
        productCost: landed.productCost || productCostFromRecon,
      });
      // Legacy band for compatibility
      const deliveryMateriality = assessDeliveryMateriality(
        landed.productCost || (unitCost ?? 0) * line.quantity,
        deliveryEv,
      );
      if (deliveryEv.known && deliveryEv.amount != null) {
        anyDeliveryKnown = true;
        deliveryTotal += deliveryEv.amount;
      }
      if (lineDeliveryV2.allowance > 0) {
        deliveryAllowanceTotal += lineDeliveryV2.allowance;
      }
      if (lineDeliveryV2.blocksAutoQuoted) deliveryV2Blocks = true;
      deliveryV2Summary = lineDeliveryV2;

      await writeAuditEvent(
        {
          action: "DELIVERY_EVIDENCE_CAPTURED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: {
            lineNumber: line.lineNumber,
            delivery: deliveryEv,
            materiality: deliveryMateriality,
            deliveryV2: lineDeliveryV2,
          },
        },
        prisma,
      );
      await writeAuditEvent(
        {
          action: "DELIVERY_MATERIALITY_ASSESSED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: {
            lineNumber: line.lineNumber,
            class: lineDeliveryV2.class,
            blocks: lineDeliveryV2.blocksAutoQuoted,
          },
        },
        prisma,
      );

      const vatNorm = normalizeSupplierPriceForComparison({
        price: selectedCandidate?.price ?? 0,
        vatBasis:
          selectedCandidate?.vatTreatment === "INCLUSIVE" ||
          selectedCandidate?.vatTreatment === "VAT_INCLUSIVE"
            ? "VAT_INCLUSIVE"
            : selectedCandidate?.vatTreatment === "EXCLUSIVE" ||
                selectedCandidate?.vatTreatment === "VAT_EXCLUSIVE"
              ? "VAT_EXCLUSIVE"
              : selectedCandidate?.vatTreatment === "NON_VAT"
                ? "NON_VAT"
                : "UNKNOWN",
      });
      if (!vatNorm.usable && selectedCandidate?.priceKnown) {
        vatAcceptable = false;
      }

      if (!priceKnown) evidenceWeak = true;
      totalProductCost += landed.productCost;

      const matchVerdict =
        scoredInputs.find((s) => s.id === selectedId)?.matchVerdict ??
        ("INSUFFICIENT_INFORMATION" as const);
      const evidenceLevel = selectedCandidate?.evidenceLevel ?? null;

      const lineConf = scoreLineResearchConfidence({
        specMatch: mayAutoSelect(matchVerdict) ? 0.9 : 0.4,
        sourceQuality:
          scoredInputs.find((s) => s.id === selectedId)?.sourceCredibility ?? 0.3,
        sourceCount: Math.min(1, multi.count / 3),
        priceConsistency:
          multi.dispersionCv != null && multi.dispersionCv < 0.25 ? 0.85 : 0.45,
        vatClarity: vatNorm.usable ? 0.8 : 0.3,
        packClarity: recon?.firm ? 0.9 : 0.3,
        availability: selectedCandidate?.availability ? 0.8 : 0.4,
        deliveryEvidence: deliveryEv.known ? 0.9 : 0.2,
        freshness: isUsableForAutonomousPricing(
          freshnessBand(
            ageDaysFromRetrieved(
              selectedCandidate?.retrievedAt ?? new Date(0),
              new Date(),
            ),
          ),
        )
          ? 0.9
          : 0.2,
      });

      const lineFlags = [
        ...landed.flags,
        ...multi.flags,
        ...(recon?.flags ?? []),
        ...(lineDeliveryV2.blocksAutoQuoted
          ? ["DELIVERY_MATERIAL_UNKNOWN"]
          : []),
        `PROCUREMENT_COST_SELECTION_REASON:${costPick.reason}`,
      ];

      const qtyOk = Boolean(recon?.firm);
      const basisOk = Boolean(
        recon && isFirmPriceBasis(recon.supplierPriceBasis),
      );
      const packOk = Boolean(
        recon && isFirmPackEvidence(recon.packExtraction),
      );

      guardrailLines.push({
        lineNumber: line.lineNumber,
        unresolved: landed.unresolved || !selectedId || !priceKnown,
        matchVerdict,
        evidenceLevel,
        evidenceAgeHours: selectedCandidate?.evidenceAgeHours ?? null,
        flags: lineFlags,
        lineConfidence: lineConf.score,
        liveEvidence: researchByLine[line.lineNumber].liveCount > 0,
        multiSource: multi.count >= 2,
        packResolved: packOk,
        vatMaterialUnknown: !vatNorm.usable,
        deliveryMaterialUnknown: lineDeliveryV2.blocksAutoQuoted,
        quantityReconciled: qtyOk,
        priceBasisKnown: basisOk,
        packEconomicsPassed: qtyOk && packOk && basisOk,
      });

      integrityLines.push({
        lineNumber: line.lineNumber,
        material: true,
        reconciliation: recon,
        priceBasisKnown: basisOk,
        packKnownWhereRelevant: packOk,
        unitMismatch: Boolean(recon?.flags.includes("UNIT_MISMATCH")),
        specSelectable: mayAutoSelect(matchVerdict),
      });

      const provisionalMarkup = 25;
      const lineSell = priceKnown
        ? calculatePricing({
            supplierCost: landed.productCost,
            markupPercent: provisionalMarkup,
            vatRegistered: false,
          })
        : null;

      pricedLines.push({
        lineNumber: line.lineNumber,
        description: line.originalWording,
        quantity: line.quantity,
        unit: line.unit,
        unitCost: unitCost ?? 0,
        unitSell: lineSell
          ? line.quantity > 0
            ? lineSell.sellingPriceExVat / line.quantity
            : 0
          : 0,
        lineSell: lineSell?.sellingPriceExVat ?? 0,
        productCost: landed.productCost,
        flags: landed.flags,
        unresolved: landed.unresolved,
        evidenceLevel: evidenceLevel ?? "AI_ESTIMATE",
        matchVerdict,
        candidateId: selectedId,
        reconciliation: recon,
      });
    }

    artifacts.quantityReconciliations = reconciliations.map((r) => ({
      tenderQuantity: r.tenderQuantity,
      tenderUnit: r.tenderUnit,
      packsRequired: r.packsRequired,
      procurementCost: r.procurementCost,
      firm: r.firm,
      humanReadable: r.humanReadable,
      flags: r.flags,
    }));

    artifacts.matching = matchArtifacts;
    artifacts.selection = selectionArtifacts;

    // —— PRICING / MARKUP / RISK ALLOWANCE ——
    await transition(prisma, rfq.id, "PRICING");
    const prior = rfq.pricingScenarios[0];
    const logisticsFromPrior = prior
      ? toNumber(Number(prior.logisticsCost))
      : 0;
    if (logisticsFromPrior > 0) {
      reasons.push(
        "Prior logistics amount present — treated as identifiable direct cost with review flag",
      );
    }

    const deliveryForLanded = anyDeliveryKnown ? deliveryTotal : 0;

    const materialDeliveryUnknown =
      deliveryV2Blocks ||
      guardrailLines.some((l) => l.deliveryMaterialUnknown);

    // Aggregate delivery materiality on total product cost when no known delivery
    if (!anyDeliveryKnown && totalProductCost > 0) {
      deliveryV2Summary = classifyDeliveryV2({
        delivery: {
          type: "UNKNOWN_DELIVERY",
          amount: null,
          threshold: null,
          destinationAssumption: null,
          source: null,
          known: false,
          notes: [],
        },
        productCost: totalProductCost,
      });
      if (
        deliveryV2Summary.class === "UNKNOWN_IMMATERIAL" &&
        deliveryAllowanceTotal === 0
      ) {
        deliveryAllowanceTotal = deliveryV2Summary.allowance;
        reasons.push(deliveryV2Summary.reason);
      } else if (deliveryV2Summary.blocksAutoQuoted) {
        deliveryV2Blocks = true;
        reasons.push(
          `MATERIAL unknown delivery (${deliveryV2Summary.class}) — not buried in markup`,
        );
      }
    } else if (materialDeliveryUnknown) {
      reasons.push(
        "MATERIAL unknown delivery — unresolved delivery component; not buried in markup",
      );
    }

    const risk = buildRiskAllowances({
      deliveryAllowance: deliveryAllowanceTotal,
      deliveryReason: "Delivery materiality V2 allowance (policy)",
    });
    artifacts.riskAllowance = risk;
    if (risk.total > 0) {
      await writeAuditEvent(
        {
          action: "RISK_ALLOWANCE_APPLIED",
          entityType: "Rfq",
          entityId: rfq.id,
          newState: risk,
        },
        prisma,
      );
    }

    const highConfidence =
      guardrailLines.every(
        (l) =>
          !l.unresolved &&
          l.matchVerdict &&
          (l.matchVerdict === "EXACT_MATCH" ||
            l.matchVerdict === "ACCEPTABLE_EQUIVALENT") &&
          (l.lineConfidence ?? 0) >= RESEARCH_POLICY.autoQuoted.minLineConfidence,
      ) && !evidenceWeak;

    const markup = selectMarkupPolicy({
      highConfidence,
      deliveryUnknown: !anyDeliveryKnown,
      simpleTransaction: !packAmbiguity,
      operationalComplexity: false,
    });
    artifacts.markup = markup;

    const commercial = buildLandedBreakdown({
      productCost: totalProductCost,
      deliveryCost: deliveryForLanded,
      riskAllowance: risk.total,
      otherDirectCost: logisticsFromPrior,
      markupPercent: markup.markupPercent,
    });
    const landedCost = commercial.landedCost;

    // Cost waterfall (exact reconciliation)
    const waterfallLines = pricedLines
      .filter((pl) => !pl.unresolved && pl.reconciliation?.firm)
      .map((pl) =>
        buildLineWaterfall({
          lineNumber: pl.lineNumber,
          observedSupplierPrice: pl.reconciliation?.observedSupplierPrice ?? null,
          supplierSellingUnit:
            pl.reconciliation?.supplierSellingUnit ?? "UNKNOWN",
          packSize: pl.reconciliation?.supplierPackSize ?? null,
          packsRequired: pl.reconciliation?.packsRequired ?? null,
          unitsPurchased: pl.reconciliation?.unitsPurchased ?? null,
          surplusUnits: pl.reconciliation?.surplusUnits ?? null,
          normalizedProductCost: pl.productCost,
          markupPercent: markup.markupPercent,
        }),
      );
    const waterfall = buildRfqWaterfall(waterfallLines, markup.markupPercent, {
      delivery: deliveryForLanded,
      riskAllowances: risk.total,
      otherDirectCosts: logisticsFromPrior,
    });
    artifacts.costWaterfall = waterfall;

    // Historical variance (comparator, not truth)
    const historicalProduct = (() => {
      const priorLanded = prior ? toNumber(Number(prior.landedCost)) : null;
      if (priorLanded && priorLanded > 0) return priorLanded;
      return null;
    })();
    // Prefer sum of captured public-ref line costs when present on this RFQ
    const capturedQuoteProduct = rfq.quotes
      ?.flatMap((q: { lineItems: Array<{ unitCost: unknown; quantity: unknown; description: string | null }> }) =>
        q.lineItems,
      )
      .filter(
        (li: { description: string | null }) =>
          li.description && !/logistics|delivery/i.test(li.description),
      )
      .reduce(
        (s: number, li: { unitCost: unknown; quantity: unknown }) =>
          s +
          toNumber(Number(li.unitCost ?? 0)) * toNumber(Number(li.quantity ?? 0)),
        0,
      );
    const oldComparator =
      capturedQuoteProduct && capturedQuoteProduct > 0
        ? capturedQuoteProduct
        : historicalProduct;

    // Extreme variance triggers second-source investigation — never invent explanations.
    let variance = classifyPriceVariance({
      oldCost: oldComparator,
      newCost: totalProductCost,
      explanationCode: null,
      explanationText:
        oldComparator != null
          ? `Historical comparator R${oldComparator} vs live reconciled R${totalProductCost}`
          : null,
    });

    if (variance.band === "EXTREME_VARIANCE") {
      await writeAuditEvent(
        {
          action: "PRICE_VARIANCE_DETECTED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: variance,
        },
        prisma,
      );
      await writeAuditEvent(
        {
          action: "VARIANCE_INVESTIGATION_STARTED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: { oldCost: oldComparator, newCost: totalProductCost },
        },
        prisma,
      );

      const signals: VarianceEvidenceSignal[] = [];
      if (reconciliations.some((r) => (r.supplierPackSize ?? 1) > 1 && r.firm)) {
        signals.push({
          code: "DIFFERENT_PACK_QUANTITY",
          evidence:
            "Live firm candidates use explicit pack economics vs historical EACH assumption",
          confidence: 0.8,
        });
      }
      if (packAmbiguity) {
        signals.push({
          code: "UNIT_OF_MEASURE_CORRECTION",
          evidence: "Pack/price basis ambiguity corrected by integrity gate",
          confidence: 0.75,
        });
      }
      // Stale historical public-ref when live firm lines diverge sharply
      if (
        oldComparator != null &&
        totalProductCost > 0 &&
        Math.abs(totalProductCost - oldComparator) / oldComparator > 0.75 &&
        reconciliations.filter((r) => r.firm).length >= 2
      ) {
        signals.push({
          code: "OLD_EVIDENCE_STALE",
          evidence:
            "Multiple firm live sources diverge >75% from historical public-ref",
          confidence: 0.72,
        });
      }

      const investigation = investigateExtremeVariance({
        variance,
        signals,
        additionalSearches: optimizerResults.flatMap((o) =>
          o.candidates
            .filter((c) => c.sourceUrl)
            .map((c) => c.sourceUrl!)
            .slice(0, 2),
        ),
        additionalCandidateIds: optimizerResults.flatMap((o) =>
          o.candidates.map((c) => c.id),
        ),
      });
      artifacts.varianceInvestigation = investigation;
      variance = reclassifyVarianceAfterInvestigation(variance, investigation);

      await writeAuditEvent(
        {
          action: investigation.resolved
            ? "VARIANCE_INVESTIGATION_RESOLVED"
            : "VARIANCE_INVESTIGATION_FAILED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: investigation,
        },
        prisma,
      );
      if (investigation.resolved && investigation.explanation) {
        await writeAuditEvent(
          {
            action: "PRICE_VARIANCE_EXPLAINED",
            entityType: "Rfq",
            entityId: rfq.id,
            metadata: { explanation: investigation.explanation },
          },
          prisma,
        );
      }
    } else if (variance.band === "HIGH_VARIANCE") {
      await writeAuditEvent(
        {
          action: "PRICE_VARIANCE_DETECTED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: variance,
        },
        prisma,
      );
    }
    artifacts.priceVariance = variance;

    const optMetrics = aggregateOptimizerMetrics(optimizerResults);
    artifacts.procurementOptimizer = optimizerResults.map((o) => ({
      lineNumber: o.lineNumber,
      strategy: o.strategy,
      recommended: o.recommendedCandidateId,
      reason: o.winnerReason,
      metrics: o.metrics,
      comparison: o.ranked.map((r) => ({
        id: r.candidate.id,
        supplier: r.candidate.supplier,
        product: r.candidate.productTitle,
        rank: r.rank,
        landed: r.candidate.landedProcurementCost,
        spec: r.candidate.specification.classification,
        stock: r.candidate.stock.class,
        firm: r.candidate.commercialIntegrityFirm,
        disqualified: r.disqualified,
      })),
    }));
    artifacts.optimizerMetrics = {
      ...optMetrics,
      potentialSavingsVsFirstValid: roundMoney(potentialSavings),
      procurementSavingsIdentified: roundMoney(potentialSavings),
      extremeVarianceInvestigations:
        artifacts.varianceInvestigation != null ? 1 : 0,
      varianceResolved: Boolean(
        (artifacts.varianceInvestigation as { resolved?: boolean } | undefined)
          ?.resolved,
      ),
      varianceUnresolved: Boolean(
        artifacts.varianceInvestigation &&
          !(artifacts.varianceInvestigation as { resolved?: boolean }).resolved,
      ),
    };

    // Recompute line sells with selected markup
    for (const pl of pricedLines) {
      if (pl.unresolved) continue;
      const priced = calculatePricing({
        supplierCost: pl.productCost,
        markupPercent: markup.markupPercent,
        vatRegistered: false,
      });
      pl.lineSell = priced.sellingPriceExVat;
      pl.unitSell =
        pl.quantity > 0 ? priced.sellingPriceExVat / pl.quantity : 0;
    }

    const integrity = evaluateCommercialIntegrity({
      lines: integrityLines,
      variance,
      delivery: deliveryV2Summary,
      waterfall,
      vatAcceptable,
    });
    artifacts.commercialIntegrity = integrity;
    await writeAuditEvent(
      {
        action: integrity.passed
          ? "COMMERCIAL_INTEGRITY_PASSED"
          : "COMMERCIAL_INTEGRITY_FAILED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: integrity,
      },
      prisma,
    );

    const qtyRate =
      reconciliations.length > 0
        ? reconciliations.filter((r) => r.firm).length / reconciliations.length
        : 0;
    const packRate =
      reconciliations.length > 0
        ? reconciliations.filter((r) =>
            isFirmPackEvidence(r.packExtraction),
          ).length / reconciliations.length
        : 0;
    const basisRate =
      reconciliations.length > 0
        ? reconciliations.filter((r) =>
            isFirmPriceBasis(r.supplierPriceBasis),
          ).length / reconciliations.length
        : 0;
    artifacts.integrityMetrics = {
      QUANTITY_RECONCILIATION_RATE: qtyRate,
      PACK_SIZE_RESOLUTION_RATE: packRate,
      PRICE_BASIS_RESOLUTION_RATE: basisRate,
      EXTREME_VARIANCE_RATE: variance.band === "EXTREME_VARIANCE" ? 1 : 0,
      COMMERCIAL_INTEGRITY_PASS_RATE: integrity.passed ? 1 : 0,
    };

    await writeAuditEvent(
      {
        action: "PRICING_EVIDENCE_CAPTURED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: {
          evidenceLevels: pricedLines.map((p) => p.evidenceLevel),
          integrityMetrics: artifacts.integrityMetrics,
        },
      },
      prisma,
    );
    await writeAuditEvent(
      {
        action: "LANDED_COST_CALCULATED",
        entityType: "Rfq",
        entityId: rfq.id,
        newState: {
          productCost: totalProductCost,
          delivery: deliveryForLanded,
          riskAllowance: risk.total,
          logistics: logisticsFromPrior,
          landedCost,
          waterfall,
        },
      },
      prisma,
    );
    await writeAuditEvent(
      {
        action: "MARKUP_POLICY_APPLIED",
        entityType: "Rfq",
        entityId: rfq.id,
        newState: {
          ...markup,
          markupPercent: commercial.markupPercent,
          grossMarginPercent: commercial.grossMarginPercent,
          note: "Markup not used to compensate unknown delivery",
        },
      },
      prisma,
    );

    artifacts.pricing = {
      ...commercial,
      lines: pricedLines.map((p) => ({
        ...p,
        reconciliation: p.reconciliation
          ? {
              humanReadable: p.reconciliation.humanReadable,
              packsRequired: p.reconciliation.packsRequired,
              procurementCost: p.reconciliation.procurementCost,
              effectiveTenderUnitCost: p.reconciliation.effectiveTenderUnitCost,
              firm: p.reconciliation.firm,
              flags: p.reconciliation.flags,
            }
          : null,
      })),
    };

    // —— QUOTATION ——
    await transition(prisma, rfq.id, "QUOTATION_GENERATION");
    const company = rfq.selectedCompany;
    const quotationNumber = `AQ-${rfq.internalId}-${Date.now().toString(36).toUpperCase()}`;
    const customerFacing = generateCustomerQuotation({
      rfqReference: rfq.tenderNumber ?? rfq.internalId,
      institution: rfq.buyer,
      quotationNumber,
      quotationDate: new Date(),
      validityDays: 30,
      company: {
        legalName: company?.legalName ?? "COMPANY NOT SELECTED",
        registrationNumber: company?.registrationNumber,
        csdNumber: company?.csdNumber,
        address: company?.physicalAddress ?? company?.postalAddress,
        contactName: company?.contactName,
        contactEmail: company?.contactEmail,
        contactPhone: company?.contactPhone,
        vatRegistered: company?.vatRegistered ?? false,
      },
      lines: pricedLines
        .filter((l) => !l.unresolved)
        .map((l) => ({
          lineNumber: l.lineNumber,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unitSellingPrice: l.unitSell,
        })),
      deliveryAmount: deliveryForLanded + logisticsFromPrior > 0
        ? deliveryForLanded + logisticsFromPrior * (1 + markup.markupPercent / 100)
        : 0,
      commercialNotes: [
        "Draft quotation for Founder review. Not submitted.",
        "Prices subject to stock availability.",
      ],
      includeBanking: false,
    });

    const leaks = detectInternalDataLeakage(customerFacing);
    if (leaks.length) {
      reasons.push(`Quotation leakage scrub needed: ${leaks.join(",")}`);
    }

    await prisma.autonomousQuotation.create({
      data: {
        rfqId: rfq.id,
        quotationNumber,
        companyLegalName: customerFacing.company.legalName,
        companyId: company?.id,
        institution: rfq.buyer,
        rfqReference: rfq.tenderNumber ?? rfq.internalId,
        validityDays: 30,
        linesJson: JSON.stringify(customerFacing.lines),
        subtotalExVat: customerFacing.subtotal,
        vatAmount: customerFacing.vatAmount,
        deliveryAmount: customerFacing.delivery,
        totalAmount: customerFacing.total,
        vatRegistered: company?.vatRegistered ?? false,
        commercialNotes: customerFacing.commercialNotes.join("\n"),
        customerFacingJson: JSON.stringify(customerFacing),
        internalSnapshotJson: JSON.stringify({
          landedCost,
          markup,
          commercial,
          pricedLines: pricedLines.map((p) => ({
            lineNumber: p.lineNumber,
            unitCost: p.unitCost,
            evidenceLevel: p.evidenceLevel,
            matchVerdict: p.matchVerdict,
          })),
        }),
      },
    });
    artifacts.quotation = {
      quotationNumber,
      customerFacing,
      leaks,
    };
    await writeAuditEvent(
      {
        action: "QUOTATION_GENERATED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: { quotationNumber, total: customerFacing.total },
      },
      prisma,
    );

    // —— OUTCOME ——
    await transition(prisma, rfq.id, "COMPLIANCE_CHECK");
    const resolvedRatio =
      guardrailLines.filter((l) => !l.unresolved).length /
      Math.max(guardrailLines.length, 1);
    const confidence = Math.min(
      0.95,
      classification.confidence * 0.35 +
        understanding.overallConfidence * 0.2 +
        resolvedRatio * 0.35 +
        (highConfidence ? 0.15 : 0),
    );

    const lineScores = guardrailLines.map((l) => l.lineConfidence ?? 0);
    const sourcingConfidence = overallSourcingConfidence(lineScores);
    const confidenceMerged = Math.min(confidence, sourcingConfidence + 0.15);

    const optAllOk = optimizerResults.every(
      (o) =>
        o.strategy.type === "SINGLE_SUPPLIER" ||
        o.strategy.type === "SPLIT_SUPPLIER",
    );
    const stockOk = optimizerResults.every((o) => {
      const winner =
        o.recommendedCandidateId != null
          ? o.candidates.find((c) => c.id === o.recommendedCandidateId)
          : o.strategy.allocations[0]
            ? o.candidates.find(
                (c) => c.id === o.strategy.allocations[0].candidateId,
              )
            : null;
      return !winner || winner.stock.class !== "OUT_OF_STOCK";
    });
    const credOk = optimizerResults.every((o) =>
      o.candidates
        .filter((c) =>
          o.strategy.allocations.some((a) => a.candidateId === c.id) ||
          c.id === o.recommendedCandidateId,
        )
        .every((c) => !c.integrityFlags.includes("CREDIBILITY_LOW_OR_UNKNOWN")),
    );

    const guardrail = classifyAutonomousOutcome({
      eligibility: eligibilityVerdict,
      compulsoryBriefingMissed: briefingMissed,
      closingDeadlinePassed: closingPassed,
      mandatoryRequirementUnsatisfied: false,
      tenderValueExceedsThreshold: false,
      lines: guardrailLines,
      confidence: confidenceMerged,
      classificationConfident: classification.confidence >= 0.55,
      boqComplete: normalized.length > 0,
      commercialIntegrityPassed: integrity.passed,
      commercialIntegrityFailures: integrity.failures,
      livePricingCredible: !evidenceWeak && qtyRate >= 0.5,
      unexplainedExtremeVariance: variance.blocksAutoQuoted,
      procurementOptimized: optAllOk,
      stockSufficient: stockOk,
      supplierCredibilityAcceptable: credOk,
      extremeVarianceResolved:
        variance.band !== "EXTREME_VARIANCE" || !variance.blocksAutoQuoted,
    });
    artifacts.outcome = guardrail;
    artifacts.guardrails = guardrail;

    return await finalize(prisma, rfq, {
      state: guardrail.state,
      outcome: guardrail.outcome,
      confidence: confidenceMerged,
      reasons: [...reasons, ...guardrail.reasons],
      artifacts,
      started,
      quotationNumber,
      webResearchCoverage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = isRetryableFailure(message);
    const retryCount = rfq.autonomousRetryCount + (retryable ? 1 : 0);
    await writeAuditEvent(
      {
        action: "AUTONOMOUS_PROCESSING_FAILED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: { message, retryable, retryCount },
      },
      prisma,
    );
    await prisma.rfq.update({
      where: { id: rfq.id },
      data: {
        autonomousState: "FAILED",
        autonomousOutcome: "FAILED",
        autonomousFailureReason: message,
        autonomousRetryCount: retryCount,
        autonomousCompletedAt: new Date(),
        autonomousDurationMs: Date.now() - started,
        autonomousClaimToken: null,
        autonomousClaimExpiresAt: null,
        autonomousLastStep: "FAILED",
        autonomousRunJson: JSON.stringify({ artifacts, error: message }),
      },
    });
    return {
      rfqId: rfq.id,
      internalId: rfq.internalId,
      outcome: "FAILED",
      state: "FAILED",
      confidence: null,
      durationMs: Date.now() - started,
      reasons: [message],
      quotationNumber: null,
    };
  }
}

async function finalize(
  prisma: PrismaClient,
  rfq: { id: string; internalId: string },
  opts: {
    state: DomainState;
    outcome: AutonomousOutcome | "SKIPPED_NOT_SUPPLY";
    confidence: number;
    reasons: string[];
    artifacts: RunArtifacts;
    started: number;
    quotationNumber?: string;
    webResearchCoverage?: number;
  },
): Promise<ProcessResult> {
  const outcome = (opts.outcome === "SKIPPED_NOT_SUPPLY"
    ? "SKIPPED_NOT_SUPPLY"
    : opts.outcome) as AutonomousOutcome;
  const durationMs = Date.now() - opts.started;

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      autonomousState: opts.state as AutonomousProcessingState,
      autonomousOutcome: outcome,
      autonomousConfidence: opts.confidence,
      autonomousCompletedAt: new Date(),
      autonomousDurationMs: durationMs,
      autonomousFailureReason:
        outcome === "FAILED" ? opts.reasons.join("; ") : null,
      autonomousLastStep: opts.state,
      autonomousClaimToken: null,
      autonomousClaimExpiresAt: null,
      autonomousWorkerVersion: WORKER_VERSION,
      autonomousRunJson: JSON.stringify({
        reasons: opts.reasons,
        artifacts: opts.artifacts,
      }),
      liveResearchMetricsJson: opts.artifacts.liveResearch
        ? JSON.stringify(opts.artifacts.liveResearch)
        : null,
      webResearchCoverage: opts.webResearchCoverage ?? opts.artifacts.webResearchCoverage ?? null,
      // Map to founder-facing pipeline without submitting
      ...(outcome === "AUTO_QUOTED" || outcome === "REVIEW_REQUIRED"
        ? {
            status: "FOUNDER_REVIEW" as const,
            inFounderBidQueue: true,
            nextAction: "FOUNDERS_REVIEW" as const,
          }
        : {}),
    },
  });

  const auditAction =
    outcome === "AUTO_QUOTED"
      ? "RFQ_AUTO_QUOTED"
      : outcome === "REVIEW_REQUIRED"
        ? "RFQ_REVIEW_REQUIRED"
        : outcome === "UNPRICEABLE"
          ? "RFQ_UNPRICEABLE"
          : outcome === "INELIGIBLE"
            ? "RFQ_INELIGIBLE"
            : outcome === "FAILED"
              ? "AUTONOMOUS_PROCESSING_FAILED"
              : "AUTONOMOUS_PROCESSING_COMPLETED";

  await writeAuditEvent(
    {
      action: auditAction,
      entityType: "Rfq",
      entityId: rfq.id,
      newState: { outcome, state: opts.state, reasons: opts.reasons },
    },
    prisma,
  );
  await writeAuditEvent(
    {
      action: "AUTONOMOUS_PROCESSING_COMPLETED",
      entityType: "Rfq",
      entityId: rfq.id,
      metadata: {
        outcome,
        durationMs,
        worker: WORKER_VERSION,
      },
    },
    prisma,
  );

  return {
    rfqId: rfq.id,
    internalId: rfq.internalId,
    outcome,
    state: opts.state as AutonomousProcessingState,
    confidence: opts.confidence,
    durationMs,
    reasons: opts.reasons,
    quotationNumber: opts.quotationNumber ?? null,
    webResearchCoverage: opts.webResearchCoverage ?? null,
  };
}

/**
 * Process up to `limit` RFQs continuously. Failures are isolated.
 */
export async function runAutonomousQueue(
  prisma: PrismaClient,
  opts?: {
    limit?: number;
    preferInternalId?: string;
    processOpts?: ProcessOptions;
  },
): Promise<ProcessResult[]> {
  const limit = opts?.limit ?? 10;
  const results: ProcessResult[] = [];

  for (let i = 0; i < limit; i++) {
    const prefer =
      i === 0 && opts?.preferInternalId
        ? opts.preferInternalId
        : undefined;
    const claim = await claimNextRfq(prisma, {
      preferInternalId: prefer,
    });
    if (!claim) break;
    try {
      const result = await processClaimedRfq(
        prisma,
        claim.id,
        claim.claimToken,
        opts?.processOpts,
      );
      results.push(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        rfqId: claim.id,
        internalId: "?",
        outcome: "FAILED",
        state: "FAILED",
        confidence: null,
        durationMs: 0,
        reasons: [`Isolated failure: ${message}`],
        quotationNumber: null,
      });
      await prisma.rfq.update({
        where: { id: claim.id },
        data: {
          autonomousState: "FAILED",
          autonomousOutcome: "FAILED",
          autonomousFailureReason: message,
          autonomousClaimToken: null,
          autonomousClaimExpiresAt: null,
        },
      });
    }
  }

  return results;
}

export { outcomeFromState, WORKER_VERSION };
