"use server";

import { revalidatePath } from "next/cache";
import { createNoBidDecision, type NoBidCategory } from "@/domain/nobid";
import type { OpportunityClass } from "@/domain/classification";
import { classifyOpportunity } from "@/domain/classification";
import {
  detectHardBlockersFromText,
  inferSpecificationClarity,
  inferSupplierFeasibility,
  qualifyOpportunity,
} from "@/domain/qualification";
import { determineNextAction } from "@/domain/nextAction";
import { assertTransition } from "@/domain/status";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/domain/permissions";
import { writeAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";

export async function recordNoBidAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "rfq:nobid")) {
    throw new Error("Not authorised to record NO BID");
  }

  const rfqId = String(formData.get("rfqId") ?? "");
  const category = String(formData.get("category") ?? "") as NoBidCategory;
  const notes = String(formData.get("notes") ?? "");

  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId } });
  if (!rfq) throw new Error("RFQ not found");

  const decision = createNoBidDecision({
    currentStatus: rfq.status,
    category,
    notes,
    decidedBy: session.role === "FOUNDER" ? "FOUNDER" : "OPERATOR",
  });
  if (!decision.ok) throw new Error(decision.error ?? "NO BID rejected");

  assertTransition(rfq.status, "NO_BID");

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      status: "NO_BID",
      noBidCategory: decision.category,
      noBidReason: decision.reason,
      noBidNotes: decision.notes,
      noBidDecidedAt: new Date(),
      nextAction: "AWAIT_DEADLINE",
      nextActionReason: decision.reason,
    },
  });

  await prisma.rfqStatusEvent.create({
    data: {
      rfqId,
      fromStatus: rfq.status,
      toStatus: "NO_BID",
      userId: session.id,
      reason: decision.reason,
    },
  });

  await writeAuditEvent({
    action: "RFQ_NO_BID",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    previousState: { status: rfq.status },
    newState: {
      status: "NO_BID",
      category: decision.category,
      reason: decision.reason,
    },
  });

  revalidatePath("/");
  revalidatePath("/rfqs");
  revalidatePath(`/rfqs/${rfqId}`);
}

export async function overrideClassificationAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "rfq:qualify")) {
    throw new Error("Not authorised");
  }

  const rfqId = String(formData.get("rfqId") ?? "");
  const override = String(formData.get("override") ?? "") as OpportunityClass;
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId } });
  if (!rfq) throw new Error("RFQ not found");

  const heuristic = classifyOpportunity(
    {
      title: rfq.title,
      description: rfq.description,
      category: rfq.category,
    },
    override,
  );

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      classificationOverride: override,
      classification: heuristic.effective,
      classificationSource: "MANUAL",
      classificationReasoning: heuristic.reasoning,
      classificationConfidence: heuristic.confidence,
    },
  });

  await writeAuditEvent({
    action: "RFQ_CLASSIFIED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    previousState: { classification: rfq.classification },
    newState: { classification: override, source: "MANUAL" },
  });

  revalidatePath(`/rfqs/${rfqId}`);
}

export async function overrideQualificationAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "rfq:qualify")) {
    throw new Error("Not authorised");
  }

  const rfqId = String(formData.get("rfqId") ?? "");
  const override = String(formData.get("override") ?? "") as
    | "GREEN"
    | "AMBER"
    | "RED";
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: { documents: true },
  });
  if (!rfq) throw new Error("RFQ not found");

  const text = `${rfq.title}\n${rfq.description ?? ""}`;
  const classification = (rfq.classificationOverride ??
    rfq.classification ??
    "OTHER") as OpportunityClass;
  const result = qualifyOpportunity({
    classification,
    classificationConfidence: rfq.classificationConfidence ?? 0.5,
    closingAt: rfq.closingAt,
    closingTimeKnown: rfq.closingTimeKnown,
    submissionMethod: rfq.submissionMethod,
    briefingCompulsory: rfq.briefingCompulsory,
    briefingCompulsoryKnown: rfq.briefingCompulsoryKnown,
    briefingDate: rfq.briefingDate,
    specificationClarity: inferSpecificationClarity(rfq.description),
    supplierFeasibility: inferSupplierFeasibility(classification, text),
    companyEligibility: "UNKNOWN",
    capitalRequirement: "UNKNOWN",
    deliveryComplexity: "UNKNOWN",
    commercialPotential: "UNKNOWN",
    hardBlockers: detectHardBlockersFromText(text),
    overrideGate: override,
  });

  const next = determineNextAction({
    status: rfq.status,
    qualificationGate: result.gate,
    hardNoBid: result.hardNoBid,
    classification,
    selectedCompanyId: rfq.selectedCompanyId,
    briefingCompulsory: rfq.briefingCompulsory,
    briefingCompulsoryKnown: rfq.briefingCompulsoryKnown,
    briefingDate: rfq.briefingDate,
    documentCount: rfq.documents.length,
    closingAt: rfq.closingAt,
  });

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      qualificationOverride: override,
      qualificationGate: result.gate,
      qualificationReasons: JSON.stringify(result.reasons),
      qualificationSnapshot: JSON.stringify(result.factors),
      nextAction: next.action,
      nextActionReason: next.reason,
      status: rfq.status === "NEW" && override === "GREEN" ? "QUALIFIED" : rfq.status,
    },
  });

  if (rfq.status === "NEW" && override === "GREEN") {
    await prisma.rfqStatusEvent.create({
      data: {
        rfqId,
        fromStatus: "NEW",
        toStatus: "QUALIFIED",
        userId: session.id,
        reason: "Manual GREEN qualification override",
      },
    });
  }

  await writeAuditEvent({
    action: "RFQ_QUALIFIED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    previousState: { gate: rfq.qualificationGate },
    newState: { gate: result.gate, override: true, reasons: result.reasons },
  });

  revalidatePath(`/rfqs/${rfqId}`);
  revalidatePath("/rfqs");
  revalidatePath("/");
}

export async function proceedToReviewAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "rfq:qualify")) {
    throw new Error("Not authorised");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId } });
  if (!rfq) throw new Error("RFQ not found");

  const to = rfq.qualificationGate === "GREEN" ? "QUALIFIED" : "REVIEW";
  assertTransition(rfq.status, to);

  await prisma.rfq.update({
    where: { id: rfqId },
    data: { status: to },
  });
  await prisma.rfqStatusEvent.create({
    data: {
      rfqId,
      fromStatus: rfq.status,
      toStatus: to,
      userId: session.id,
      reason: "Operator proceed decision",
    },
  });
  await writeAuditEvent({
    action: "RFQ_STATUS_CHANGED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    previousState: { status: rfq.status },
    newState: { status: to },
  });

  revalidatePath(`/rfqs/${rfqId}`);
  revalidatePath("/rfqs");
  revalidatePath("/");
}
