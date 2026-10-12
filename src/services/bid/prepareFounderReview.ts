/**
 * Persist compliance checklist, Bid row, sourcing lifecycle, and advance to FOUNDER_REVIEW.
 * Does NOT send email. Does NOT submit tenders.
 */
import type { PrismaClient } from "@prisma/client";
import { buildComplianceChecklist } from "@/domain/complianceChecklist";
import { evaluateComplianceGate } from "@/domain/compliance";
import { canTransition } from "@/domain/status";
import { writeAuditEvent } from "@/lib/audit";

export async function prepareFounderReviewForRfq(
  prisma: PrismaClient,
  rfqInternalId: string,
  options?: { actorUserId?: string },
) {
  const rfq = await prisma.rfq.findFirst({
    where: { internalId: rfqInternalId },
    include: {
      selectedCompany: { include: { documents: true } },
      requirements: true,
      lineItems: true,
      pricingScenarios: { where: { isSelected: true }, take: 1 },
      sourcingRequests: { include: { supplier: true } },
      quotes: true,
      complianceItems: true,
      bids: true,
    },
  });
  if (!rfq) throw new Error(`RFQ ${rfqInternalId} not found`);
  if (!rfq.selectedCompanyId || !rfq.selectedCompany) {
    throw new Error("Bidding company must be selected before Founder review prep");
  }

  const checklist = buildComplianceChecklist({
    rfqInternalId: rfq.internalId,
    requirements: rfq.requirements.map((r) => ({
      requirementType: r.requirementType ?? r.category,
      description: r.description,
      isMandatory: r.isMandatory,
      evidenceSource:
        r.sourceDocument ??
        r.sourceHint ??
        r.notes ??
        `${r.provenance} requirement`,
    })),
    companyDocs: rfq.selectedCompany.documents.map((d) => ({
      documentType: d.documentType,
      verificationState: d.verificationState,
      expiryDate: d.expiryDate,
      title: d.title,
    })),
    hasPricingScenario: rfq.pricingScenarios.length > 0,
    hasLineItems: rfq.lineItems.length > 0,
    briefingCompulsory: rfq.briefingCompulsory,
    briefingCompulsoryKnown: rfq.briefingCompulsoryKnown,
  });

  for (const item of checklist) {
    await prisma.complianceRequirement.upsert({
      where: {
        rfqId_itemKey: { rfqId: rfq.id, itemKey: item.itemKey },
      },
      create: {
        rfqId: rfq.id,
        itemKey: item.itemKey,
        label: item.label,
        isMandatory: item.isMandatory,
        state: item.state,
        notes: item.notes,
        evidenceSource: item.evidenceSource,
      },
      update: {
        label: item.label,
        isMandatory: item.isMandatory,
        state: item.state,
        notes: item.notes,
        evidenceSource: item.evidenceSource,
      },
    });
  }

  await writeAuditEvent({
    action: "COMPLIANCE_GENERATED",
    entityType: "Rfq",
    entityId: rfq.id,
    userId: options?.actorUserId,
    metadata: { itemCount: checklist.length },
  });

  let bid = rfq.bids.find((b) => b.companyId === rfq.selectedCompanyId);
  if (!bid) {
    bid = await prisma.bid.create({
      data: {
        rfqId: rfq.id,
        companyId: rfq.selectedCompanyId,
        status: "COMPLIANCE",
        submissionMethod: rfq.submissionMethod,
        isDemo: false,
      },
    });
    await writeAuditEvent({
      action: "BID_CREATED",
      entityType: "Bid",
      entityId: bid.id,
      userId: options?.actorUserId,
      newState: {
        rfq: rfq.internalId,
        companyId: rfq.selectedCompanyId,
      },
    });
  }

  // Email deferred — mark sourcing jobs PENDING_EMAIL_INTEGRATION (never SENT)
  if (rfq.sourcingRequests.length > 0) {
    await prisma.sourcingRequest.updateMany({
      where: {
        rfqId: rfq.id,
        deliveryState: { in: ["DRAFT_NOT_SENT", "READY_TO_SEND", "HELD"] },
      },
      data: {
        lifecycleStatus: "PENDING_EMAIL_INTEGRATION",
        deliveryState: "DRAFT_NOT_SENT",
      },
    });
  }

  const freshCompliance = await prisma.complianceRequirement.findMany({
    where: { rfqId: rfq.id },
  });
  const gate = evaluateComplianceGate(freshCompliance);

  // Advance pipeline stepwise toward FOUNDER_REVIEW when pricing exists.
  // Founder review opens even with compliance blockers — Founder must see gaps.
  let status = rfq.status;
  const transitions: Array<{ from: string; to: string }> = [];

  const stepToward = (target: "PRICING" | "COMPLIANCE" | "FOUNDER_REVIEW") => {
    const result = canTransition(status as never, target);
    if (result.ok) {
      transitions.push({ from: status, to: target });
      status = target;
      return true;
    }
    return false;
  };

  if (
    ["NEW", "REVIEW", "QUALIFIED", "SOURCING", "AWAITING_SUPPLIERS"].includes(
      status,
    )
  ) {
    stepToward("PRICING");
  }
  if (status === "PRICING") stepToward("COMPLIANCE");
  if (status === "COMPLIANCE" && rfq.pricingScenarios.length > 0) {
    stepToward("FOUNDER_REVIEW");
  }

  for (const t of transitions) {
    await prisma.rfqStatusEvent.create({
      data: {
        rfqId: rfq.id,
        fromStatus: t.from as never,
        toStatus: t.to as never,
        userId: options?.actorUserId,
        reason: "prepareFounderReview — platform vertical slice",
      },
    });
  }

  const updated = await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      status: status as never,
      nextAction: status === "FOUNDER_REVIEW" ? "FOUNDERS_REVIEW" : "COMPLETE_COMPLIANCE",
      nextActionReason:
        status === "FOUNDER_REVIEW"
          ? gate.submissionReady
            ? "Commercial pack ready for Founder review — formal quotes still preferred before submit"
            : `Founder review opened with ${gate.blockingItems.length} compliance blocker(s)`
          : "Complete compliance before Founder review",
      inFounderBidQueue: status === "FOUNDER_REVIEW",
      profitabilityGate: rfq.profitabilityGate,
    },
  });

  await prisma.bid.update({
    where: { id: bid.id },
    data: { status: status as never },
  });

  await writeAuditEvent({
    action: "FOUNDER_REVIEW_PACK_READY",
    entityType: "Rfq",
    entityId: rfq.id,
    userId: options?.actorUserId,
    newState: {
      status,
      bidId: bid.id,
      complianceBlockers: gate.blockingItems.map((b) => b.label),
      emailTransport: "PENDING_EMAIL_INTEGRATION",
      autonomousSourcing: "OFF",
      autonomousEmail: "OFF",
      autonomousSubmission: "OFF",
    },
  });

  await writeAuditEvent({
    action: "RFQ_STATUS_CHANGED",
    entityType: "Rfq",
    entityId: rfq.id,
    userId: options?.actorUserId,
    previousState: { status: rfq.status },
    newState: { status },
  });

  return {
    rfqId: updated.id,
    internalId: updated.internalId,
    status: updated.status,
    bidId: bid.id,
    complianceItemCount: freshCompliance.length,
    complianceBlockers: gate.blockingItems.map((b) => b.label),
    submissionReady: gate.submissionReady,
    sourcingLifecycle: "PENDING_EMAIL_INTEGRATION",
    sendExecuted: false,
  };
}
