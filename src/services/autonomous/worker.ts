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
import { toNumber } from "@/domain/money";
import { LiveWebResearchProvider } from "@/services/research/liveWebProvider";
import type { LiveResearchEvent } from "@/services/research/liveWebProvider";
import { validateMultiSourcePrices } from "@/domain/multiSourcePricing";
import {
  assessDeliveryMateriality,
  deliveryRiskAllowance,
  type DeliveryEvidence,
} from "@/domain/deliveryEvidence";
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
      pricingScenarios: { where: { isSelected: true }, take: 1 },
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

      researchByLine[line.lineNumber] = {
        candidates,
        lineItemId: lineItem.id,
        liveCount,
      };
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
    };

    const pricedLines: PricedLine[] = [];
    let totalProductCost = 0;
    let anyDeliveryKnown = false;
    let deliveryTotal = 0;
    let packAmbiguity = false;
    let evidenceWeak = false;

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

        const packCalc = c.rawEvidence?.packCalculation ?? null;
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
            packSize: c.packSize,
            packUnit: c.packUnit,
            effectiveUnitCost: c.effectiveUnitCost,
            availability: c.availability,
            deliveryCost: c.deliveryCost,
            deliveryKnown: c.deliveryKnown,
            evidenceLevel: c.evidenceLevel,
            retrievedAt: c.retrievedAt,
            evidenceAgeHours: c.evidenceAgeHours,
            rawEvidenceJson: JSON.stringify(c.rawEvidence),
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
            priceType: String(c.rawEvidence?.priceType ?? null),
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
          effectiveUnitCost: c.effectiveUnitCost,
          priceKnown: c.priceKnown,
          availabilityKnown: Boolean(c.availability),
          packSizeCorrect:
            !packCalc ||
            (packCalc as { flag?: string }).flag === "OK" ||
            (packCalc as { flag?: string }).flag === "UNIT_PRICE",
          deliveryKnown: c.deliveryKnown,
          sourceCredibility: sourceQuality,
          _candidate: c,
          _match: match,
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

      const multi = validateMultiSourcePrices(
        scoredInputs
          .filter((s) => s.priceKnown && s.effectiveUnitCost != null)
          .map((s) => ({
            id: s.id,
            price: s.effectiveUnitCost as number,
            sourceQuality: s.sourceCredibility,
            matchSelectable: mayAutoSelect(s.matchVerdict),
            freshnessOk: isUsableForAutonomousPricing(
              freshnessBand(
                ageDaysFromRetrieved(
                  s._candidate.retrievedAt,
                  new Date(),
                ),
              ),
            ),
            packResolved: s.packSizeCorrect,
            flags:
              s.sourceCredibility < 0.4 ? ["WEAK_SOURCE"] : undefined,
          })),
        {
          highValueLine:
            (scoredInputs[0]?.effectiveUnitCost ?? 0) * line.quantity >=
            RESEARCH_POLICY.multiSource.highValueLineThresholdZar,
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
      selectionArtifacts.push({
        line: line.lineNumber,
        ...selection,
        multiSource: multi,
      });

      let selectedCandidate: ResearchCandidate | null = null;
      let selectedId: string | null =
        multi.selectedId && mayAutoSelect(
          scoredInputs.find((s) => s.id === multi.selectedId)?.matchVerdict ??
            "INSUFFICIENT_INFORMATION",
        )
          ? multi.selectedId
          : selection.selectedId;

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

      const unitCost = selectedCandidate?.effectiveUnitCost ?? null;
      const priceKnown = Boolean(selectedCandidate?.priceKnown && unitCost != null);
      const deliveryEv = (selectedCandidate?.rawEvidence?.delivery ?? {
        type: "UNKNOWN_DELIVERY",
        amount: null,
        known: false,
        notes: [],
      }) as DeliveryEvidence;

      const landed = calculateLineLandedCost({
        tenderQuantity: line.quantity,
        unitCost,
        priceKnown,
        deliveryKnown: deliveryEv.known === true,
        deliveryCost: deliveryEv.known ? deliveryEv.amount : null,
        vatTreatmentKnown:
          selectedCandidate?.vatTreatment !== "UNKNOWN" &&
          selectedCandidate?.vatTreatment != null,
        availabilityKnown: Boolean(selectedCandidate?.availability),
        supplierPackSize: selectedCandidate?.packSize,
        packPrice:
          selectedCandidate?.packSize && selectedCandidate.packSize > 1
            ? selectedCandidate.price
            : null,
      });

      if (landed.flags.includes("PACK_SIZE_AMBIGUITY")) packAmbiguity = true;
      const deliveryMateriality = assessDeliveryMateriality(
        landed.productCost || (unitCost ?? 0) * line.quantity,
        deliveryEv,
      );
      if (deliveryEv.known && deliveryEv.amount != null) {
        anyDeliveryKnown = true;
        deliveryTotal += deliveryEv.amount;
      }
      await writeAuditEvent(
        {
          action: "DELIVERY_EVIDENCE_CAPTURED",
          entityType: "Rfq",
          entityId: rfq.id,
          metadata: {
            lineNumber: line.lineNumber,
            delivery: deliveryEv,
            materiality: deliveryMateriality,
          },
        },
        prisma,
      );

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
        vatClarity:
          selectedCandidate?.vatTreatment &&
          selectedCandidate.vatTreatment !== "UNKNOWN"
            ? 0.8
            : 0.3,
        packClarity: landed.flags.includes("PACK_SIZE_AMBIGUITY") ? 0.3 : 0.85,
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
        ...(deliveryMateriality.band === "MATERIAL"
          ? ["DELIVERY_MATERIAL_UNKNOWN"]
          : []),
      ];

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
        packResolved: !landed.flags.includes("PACK_SIZE_AMBIGUITY"),
        vatMaterialUnknown:
          !selectedCandidate?.vatTreatment ||
          selectedCandidate.vatTreatment === "UNKNOWN",
        deliveryMaterialUnknown: deliveryMateriality.band === "MATERIAL",
      });

      // Provisional unit sell using 25% — adjusted after aggregate markup
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
      });
    }

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

    // Unknown delivery: explicit risk allowance for LOW materiality only — never raise markup
    let deliveryAllowanceTotal = 0;
    const materialDeliveryUnknown = guardrailLines.some(
      (l) => l.deliveryMaterialUnknown,
    );
    if (!anyDeliveryKnown && totalProductCost > 0 && !materialDeliveryUnknown) {
      const allowance = deliveryRiskAllowance(totalProductCost, {
        type: "UNKNOWN_DELIVERY",
        amount: null,
        threshold: null,
        destinationAssumption: null,
        source: null,
        known: false,
        notes: [],
      });
      if (allowance.apply) {
        deliveryAllowanceTotal = allowance.amount;
        reasons.push(allowance.reason);
      }
    } else if (materialDeliveryUnknown) {
      reasons.push(
        "MATERIAL unknown delivery — unresolved delivery component; not buried in markup",
      );
    }

    const risk = buildRiskAllowances({
      deliveryAllowance: deliveryAllowanceTotal,
      deliveryReason: "Low-materiality unknown delivery allowance (policy)",
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
      // deliveryUnknown intentionally ignored by policy V2
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

    await writeAuditEvent(
      {
        action: "PRICING_EVIDENCE_CAPTURED",
        entityType: "Rfq",
        entityId: rfq.id,
        metadata: {
          evidenceLevels: pricedLines.map((p) => p.evidenceLevel),
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
      lines: pricedLines,
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
