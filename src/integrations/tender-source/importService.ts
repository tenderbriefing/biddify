import type { PrismaClient } from "@prisma/client";
import { classifyOpportunity } from "@/domain/classification";
import { parseClosingDeadline, parseOptionalInstant } from "@/domain/deadlineParse";
import { detectDuplicates } from "@/domain/duplicates";
import { determineNextAction } from "@/domain/nextAction";
import { scoreOpportunity } from "@/domain/opportunityScore";
import {
  detectHardBlockersFromText,
  inferSpecificationClarity,
  inferSupplierFeasibility,
  qualifyOpportunity,
} from "@/domain/qualification";
import { etendersSourceIdentity } from "@/domain/sourceIdentity";
import { writeAuditEvent } from "@/lib/audit";
import type { SourceOpportunity } from "./types";

export type ImportOptions = {
  /** Prefer supply-and-deliver / goods RFQs. */
  supplyAndDeliverOnly?: boolean;
  /** Max opportunities to import in this run. */
  limit?: number;
  /** Only Request for Quotation methods. */
  rfqOnly?: boolean;
  userId?: string | null;
};

export type ImportResultRow = {
  sourceOpportunityId: string;
  action: "CREATED" | "UPDATED" | "SKIPPED";
  rfqId?: string;
  internalId?: string;
  classification?: string;
  qualificationGate?: string;
  nextAction?: string;
  reason?: string;
};

export type ImportBatchResult = {
  rows: ImportResultRow[];
  created: number;
  updated: number;
  skipped: number;
};

function isRfqMethod(method?: string | null): boolean {
  const m = (method || "").toLowerCase();
  return m.includes("request for quotation") || m.includes("rfq");
}

function looksSupplyAndDeliver(opp: SourceOpportunity): boolean {
  const text = `${opp.title} ${opp.description ?? ""}`;
  const explicitSupply = /\bsupply\s+and\s+deliver|\bsupply\s*&\s*deliver|\bsupply\s+and\s+delivery|\bsupply\s+of\b|\bdeliver(?:y)?\s+of\b/i.test(
    text,
  );
  const goods =
    (opp.mainProcurementCategory || "").toLowerCase() === "goods" ||
    (opp.category || "").toLowerCase() === "goods";
  const servicesOnly =
    (opp.mainProcurementCategory || "").toLowerCase() === "services" &&
    !explicitSupply &&
    !goods;
  if (servicesOnly) return false;
  const classified = classifyOpportunity({
    title: opp.title,
    description: opp.description,
    category: opp.category,
    procurementMethod: opp.procurementMethod,
    mainProcurementCategory: opp.mainProcurementCategory,
  });
  return (
    explicitSupply ||
    (goods && classified.effective === "SUPPLY_AND_DELIVER") ||
    (classified.effective === "SUPPLY_AND_DELIVER" &&
      classified.confidence >= 0.8)
  );
}

async function nextInternalId(prisma: PrismaClient): Promise<string> {
  const count = await prisma.rfq.count();
  return `BID-${String(count + 1).padStart(6, "0")}`;
}

/**
 * Idempotent import: (source, sourceOpportunityId) unique.
 * Updates source fields; preserves Biddify operational fields (status, company, no-bid, etc.).
 */
export async function syncOpportunity(
  prisma: PrismaClient,
  opp: SourceOpportunity,
  options: ImportOptions = {},
): Promise<ImportResultRow> {
  const identity = etendersSourceIdentity(opp.sourceOpportunityId);
  const closing = parseClosingDeadline(opp.closingRaw);
  if (!closing) {
    return {
      sourceOpportunityId: opp.sourceOpportunityId,
      action: "SKIPPED",
      reason: "Missing/invalid closing date from source",
    };
  }

  const text = `${opp.title}\n${opp.description ?? ""}`;
  const classification = classifyOpportunity({
    title: opp.title,
    description: opp.description,
    category: opp.category,
    procurementMethod: opp.procurementMethod,
    mainProcurementCategory: opp.mainProcurementCategory,
  });

  const hardBlockers = detectHardBlockersFromText(text);
  const specificationClarity = inferSpecificationClarity(opp.description);
  const supplierFeasibility = inferSupplierFeasibility(
    classification.effective,
    text,
  );

  const qualification = qualifyOpportunity({
    classification: classification.effective,
    classificationConfidence: classification.confidence,
    closingAt: closing.closingAt,
    closingTimeKnown: closing.closingTimeKnown,
    submissionMethod: "ETENDER",
    briefingCompulsory: Boolean(opp.briefingCompulsory),
    briefingCompulsoryKnown: opp.briefingCompulsoryKnown,
    briefingDate: parseOptionalInstant(opp.briefingDateRaw),
    specificationClarity,
    supplierFeasibility,
    companyEligibility: "UNKNOWN",
    capitalRequirement:
      /\b(oem|authorised\s+dealer|laptop|server)\b/i.test(text) ? "MEDIUM" : "UNKNOWN",
    deliveryComplexity: "UNKNOWN",
    commercialPotential: "UNKNOWN",
    hardBlockers,
  });

  const score = scoreOpportunity({
    classification: classification.effective,
    classificationConfidence: classification.confidence,
    closingAt: closing.closingAt,
    closingTimeKnown: closing.closingTimeKnown,
    specificationClarity,
    complianceFeasibility: hardBlockers.length ? "LOW" : "UNKNOWN",
    supplierFeasibility,
    deliveryComplexity: "UNKNOWN",
    submissionMethod: "ETENDER",
    capitalRequirement:
      /\b(oem|authorised\s+dealer|laptop|server)\b/i.test(text) ? "MEDIUM" : "UNKNOWN",
    hasSupplierPricing: false,
  });

  const existing = await prisma.rfq.findUnique({
    where: {
      source_sourceOpportunityId: {
        source: identity.source,
        sourceOpportunityId: identity.sourceOpportunityId,
      },
    },
    include: { documents: true },
  });

  const next = determineNextAction({
    status: existing?.status ?? "NEW",
    qualificationGate: qualification.gate,
    hardNoBid: qualification.hardNoBid,
    classification: classification.effective,
    selectedCompanyId: existing?.selectedCompanyId,
    briefingCompulsory: Boolean(opp.briefingCompulsory),
    briefingCompulsoryKnown: opp.briefingCompulsoryKnown,
    briefingDate: parseOptionalInstant(opp.briefingDateRaw),
    documentCount: opp.documents.length || existing?.documents.length || 0,
    hasOemRequirement: hardBlockers.includes("OEM_AUTHORISATION_REQUIRED"),
    closingAt: closing.closingAt,
  });

  const sourceFields = {
    source: identity.source,
    sourceOpportunityId: identity.sourceOpportunityId,
    sourceReference: opp.tenderNumber,
    tenderNumber: opp.tenderNumber,
    ocid: opp.ocid ?? opp.sourceOpportunityId,
    buyer: opp.buyer,
    department: opp.department,
    title: opp.title,
    description: opp.description,
    category: opp.category,
    province: opp.province,
    publicationDate: parseOptionalInstant(opp.publicationDate),
    sourcePublishedAt: parseOptionalInstant(opp.sourcePublishedAt),
    sourceLastModifiedAt: parseOptionalInstant(opp.sourceLastModifiedAt),
    briefingDate: parseOptionalInstant(opp.briefingDateRaw),
    briefingCompulsory: Boolean(opp.briefingCompulsory),
    briefingCompulsoryKnown: opp.briefingCompulsoryKnown,
    closingAt: closing.closingAt,
    closingTimeKnown: closing.closingTimeKnown,
    submissionMethod: "ETENDER" as const,
    sourceUrl: opp.sourceUrl,
    rawSourceMetadata: JSON.stringify(opp.raw),
    classification: classification.effective,
    classificationConfidence: classification.confidence,
    classificationReasoning: classification.reasoning,
    classificationSource: classification.source,
    qualificationGate: qualification.gate,
    qualificationReasons: JSON.stringify(qualification.reasons),
    qualificationSnapshot: JSON.stringify(qualification.factors),
    opportunityScore: score.total,
    opportunityScoreNotes: score.notes,
    opportunityScoreBreakdown: JSON.stringify(score.components),
    nextAction: next.action,
    nextActionReason: next.reason,
    isRealSource: true,
    isDemo: false,
  };

  if (!existing) {
    const internalId = await nextInternalId(prisma);
    const created = await prisma.rfq.create({
      data: {
        ...sourceFields,
        internalId,
        importedAt: new Date(),
        status: "NEW",
        documents: {
          create: opp.documents.map((d) => ({
            fileName: d.title,
            documentType: "SOURCE",
            sourceUrl: d.url,
            format: d.format ?? undefined,
            isSource: true,
            isDemo: false,
            notes: "Imported from eTenders OCDS — original source link preserved",
          })),
        },
        requirements: buildHeuristicRequirements(opp, hardBlockers),
      },
    });

    await writeAuditEvent(
      {
        action: "RFQ_IMPORTED",
        entityType: "Rfq",
        entityId: created.id,
        userId: options.userId,
        newState: {
          internalId: created.internalId,
          source: identity.source,
          sourceOpportunityId: identity.sourceOpportunityId,
        },
        metadata: {
          classification: classification.effective,
          qualificationGate: qualification.gate,
        },
      },
      prisma,
    );

    return {
      sourceOpportunityId: opp.sourceOpportunityId,
      action: "CREATED",
      rfqId: created.id,
      internalId: created.internalId,
      classification: classification.effective,
      qualificationGate: qualification.gate,
      nextAction: next.action,
    };
  }

  // Update source-derived fields only; preserve operational Biddify fields.
  const updated = await prisma.rfq.update({
    where: { id: existing.id },
    data: {
      ...sourceFields,
      // Preserve operator overrides
      classificationOverride: existing.classificationOverride,
      classification: existing.classificationOverride ?? classification.effective,
      qualificationOverride: existing.qualificationOverride,
      qualificationGate:
        existing.qualificationOverride ?? qualification.gate,
      status: existing.status,
      selectedCompanyId: existing.selectedCompanyId,
      noBidReason: existing.noBidReason,
      noBidCategory: existing.noBidCategory,
      noBidNotes: existing.noBidNotes,
      noBidDecidedAt: existing.noBidDecidedAt,
      duplicateOfId: existing.duplicateOfId,
      duplicateGroupId: existing.duplicateGroupId,
    },
  });

  // Refresh source documents if empty
  if (existing.documents.length === 0 && opp.documents.length > 0) {
    await prisma.rfqDocument.createMany({
      data: opp.documents.map((d) => ({
        rfqId: existing.id,
        fileName: d.title,
        documentType: "SOURCE",
        sourceUrl: d.url,
        format: d.format ?? undefined,
        isSource: true,
        isDemo: false,
        notes: "Imported from eTenders OCDS — original source link preserved",
      })),
    });
  }

  await writeAuditEvent(
    {
      action: "RFQ_UPDATED_FROM_SOURCE",
      entityType: "Rfq",
      entityId: updated.id,
      userId: options.userId,
      previousState: { title: existing.title, closingAt: existing.closingAt },
      newState: { title: updated.title, closingAt: updated.closingAt },
    },
    prisma,
  );

  return {
    sourceOpportunityId: opp.sourceOpportunityId,
    action: "UPDATED",
    rfqId: updated.id,
    internalId: updated.internalId,
    classification: String(
      existing.classificationOverride ?? classification.effective,
    ),
    qualificationGate: String(
      existing.qualificationOverride ?? qualification.gate,
    ),
    nextAction: next.action,
  };
}

export async function importOpportunities(
  prisma: PrismaClient,
  opportunities: SourceOpportunity[],
  options: ImportOptions = {},
): Promise<ImportBatchResult> {
  let filtered = opportunities;

  if (options.rfqOnly !== false) {
    filtered = filtered.filter((o) => isRfqMethod(o.procurementMethod));
  }
  if (options.supplyAndDeliverOnly) {
    filtered = filtered.filter(looksSupplyAndDeliver);
  }

  const limit = options.limit ?? 5;
  const slice = filtered.slice(0, limit);
  const rows: ImportResultRow[] = [];

  for (const opp of slice) {
    rows.push(await syncOpportunity(prisma, opp, options));
  }

  // Probable duplicate linking across imported + existing real RFQs
  await linkProbableDuplicates(prisma);

  return {
    rows,
    created: rows.filter((r) => r.action === "CREATED").length,
    updated: rows.filter((r) => r.action === "UPDATED").length,
    skipped: rows.filter((r) => r.action === "SKIPPED").length,
  };
}

async function linkProbableDuplicates(prisma: PrismaClient) {
  const rfqs = await prisma.rfq.findMany({
    where: { isRealSource: true },
    select: {
      id: true,
      source: true,
      sourceOpportunityId: true,
      tenderNumber: true,
      title: true,
      buyer: true,
      closingAt: true,
      selectedCompanyId: true,
      duplicateGroupId: true,
    },
  });

  const matches = detectDuplicates(rfqs);
  for (const match of matches) {
    if (match.kind === "EXACT_SOURCE") continue;
    const groupId = [match.leftId, match.rightId].sort().join("::");
    await prisma.rfq.updateMany({
      where: { id: { in: [match.leftId, match.rightId] } },
      data: { duplicateGroupId: groupId },
    });
    // Link secondary → primary without deleting
    await prisma.rfq.update({
      where: { id: match.rightId },
      data: { duplicateOfId: match.leftId },
    });
    await writeAuditEvent(
      {
        action: "RFQ_DUPLICATE_LINKED",
        entityType: "Rfq",
        entityId: match.leftId,
        metadata: match,
      },
      prisma,
    );
  }
}

function buildHeuristicRequirements(
  opp: SourceOpportunity,
  hardBlockers: string[],
) {
  const reqs: Array<{
    category: string;
    requirementType: string;
    description: string;
    isMandatory: boolean;
    provenance: "HEURISTIC" | "SOURCE_FACT";
    sourceDocument?: string;
    notes: string;
  }> = [];

  if (opp.documents[0]) {
    reqs.push({
      category: "Documentation",
      requirementType: "SOURCE_PACK",
      description: "Review official RFQ document pack from eTenders",
      isMandatory: true,
      provenance: "SOURCE_FACT",
      sourceDocument: opp.documents[0].title,
      notes: "SOURCE FACT: document listed on OCDS release",
    });
  }

  if (hardBlockers.includes("OEM_AUTHORISATION_REQUIRED")) {
    reqs.push({
      category: "Compliance",
      requirementType: "OEM",
      description: "OEM / authorised dealer letter likely required",
      isMandatory: true,
      provenance: "HEURISTIC",
      notes: "HEURISTIC from description text — verify in source PDF",
    });
  }

  if (hardBlockers.includes("MANDATORY_GRADING")) {
    reqs.push({
      category: "Compliance",
      requirementType: "GRADING",
      description: "Construction grading / CIDB indication detected",
      isMandatory: true,
      provenance: "HEURISTIC",
      notes: "HEURISTIC — confirm before bidding",
    });
  }

  return { create: reqs };
}
