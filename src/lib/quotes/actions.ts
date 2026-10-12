"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { hasPermission } from "@/domain/permissions";
import { prisma } from "@/lib/db";
import { writeAuditEvent } from "@/lib/audit";
import {
  captureManualSupplierQuote,
  rejectSupplierQuote,
  verifySupplierQuote,
} from "@/services/quotes/manualCapture";
import {
  buildRecommendationForRfq,
  refreshRfqPricingFromVerifiedQuotes,
} from "@/services/quotes/refreshPricing";
import { evaluateComplianceGate } from "@/domain/compliance";
import { evaluateSubmissionReadiness } from "@/domain/submissionReadiness";

function parseOptionalNumber(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseOptionalDate(v: FormDataEntryValue | null): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function captureSupplierQuoteAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "supplier:write")) {
    throw new Error("Not authorised to capture quotes");
  }

  const rfqId = String(formData.get("rfqId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  if (!rfqId || !supplierId) throw new Error("RFQ and supplier required");

  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: { lineItems: { orderBy: { lineNumber: "asc" } } },
  });
  if (!rfq) throw new Error("RFQ not found");

  const deliveryKnown = String(formData.get("deliveryKnown") ?? "") === "true";
  const vatKnown = String(formData.get("vatKnown") ?? "") === "true";
  const vatIncludedRaw = String(formData.get("vatIncluded") ?? "");
  const vatIncluded =
    vatIncludedRaw === "" ? null : vatIncludedRaw === "true";

  const lines = [];
  for (const li of rfq.lineItems) {
    const include = String(formData.get(`line_include_${li.id}`) ?? "") === "on";
    if (!include) continue;
    const unitCost = parseOptionalNumber(formData.get(`line_unit_${li.id}`));
    lines.push({
      rfqLineItemId: li.id,
      description:
        String(formData.get(`line_desc_${li.id}`) ?? "").trim() ||
        li.description,
      quantity: Number(li.quantity),
      unit: li.unit,
      unitCost,
      brandOffered: String(formData.get(`line_brand_${li.id}`) ?? "").trim() || null,
      manufacturer:
        String(formData.get(`line_mfr_${li.id}`) ?? "").trim() || null,
      sku: String(formData.get(`line_sku_${li.id}`) ?? "").trim() || null,
      availability:
        String(formData.get(`line_avail_${li.id}`) ?? "").trim() || null,
      specificationNotes:
        String(formData.get(`line_spec_${li.id}`) ?? "").trim() || null,
      complianceNotes:
        String(formData.get(`line_comp_${li.id}`) ?? "").trim() || null,
    });
  }

  if (lines.length === 0) {
    throw new Error("Select at least one BOQ line with quote data");
  }

  await captureManualSupplierQuote(prisma, {
    rfqId,
    supplierId,
    quoteReference: String(formData.get("quoteReference") ?? "").trim() || null,
    quoteDate: parseOptionalDate(formData.get("quoteDate")),
    validUntil: parseOptionalDate(formData.get("validUntil")),
    contactPerson: String(formData.get("contactPerson") ?? "").trim() || null,
    supplierEmail: String(formData.get("supplierEmail") ?? "").trim() || null,
    supplierVatStatus: (String(formData.get("supplierVatStatus") ?? "UNKNOWN") ||
      "UNKNOWN") as "VAT_REGISTERED" | "NOT_VAT_REGISTERED" | "UNKNOWN",
    deliveryCost: deliveryKnown
      ? parseOptionalNumber(formData.get("deliveryCost"))
      : null,
    deliveryKnown,
    deliveryLocation:
      String(formData.get("deliveryLocation") ?? "").trim() || null,
    deliveryTerms: String(formData.get("deliveryTerms") ?? "").trim() || null,
    leadTimeDays: parseOptionalNumber(formData.get("leadTimeDays")),
    paymentTerms: String(formData.get("paymentTerms") ?? "").trim() || null,
    vatIncluded,
    vatKnown,
    sourceReference:
      String(formData.get("sourceReference") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    capturedBy: session.email,
    lines,
  });

  revalidatePath(`/rfqs/${rfqId}`);
  revalidatePath("/founder-queue");
}

export async function verifySupplierQuoteAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "pricing:write")) {
    throw new Error("Not authorised");
  }
  const quoteId = String(formData.get("quoteId") ?? "");
  const rfqId = String(formData.get("rfqId") ?? "");
  await verifySupplierQuote(prisma, quoteId, session.email);
  revalidatePath(`/rfqs/${rfqId}`);
}

export async function rejectSupplierQuoteAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "pricing:write")) {
    throw new Error("Not authorised");
  }
  const quoteId = String(formData.get("quoteId") ?? "");
  const rfqId = String(formData.get("rfqId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("Rejection reason required");
  await rejectSupplierQuote(prisma, quoteId, session.email, reason);
  revalidatePath(`/rfqs/${rfqId}`);
}

export async function confirmSourcingStrategyAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "pricing:write")) {
    throw new Error("Not authorised");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  const mode = String(formData.get("mode") ?? "ACCEPT_RECOMMENDATION");
  const recommendation = await buildRecommendationForRfq(prisma, rfqId);

  if (mode === "ACCEPT_RECOMMENDATION") {
    await prisma.rfq.update({
      where: { id: rfqId },
      data: {
        sourcingStrategyType: recommendation.strategyType,
        sourcingStrategyConfirmed: true,
        sourcingStrategyJson: JSON.stringify(recommendation),
        sourcingStrategyConfirmedAt: new Date(),
        sourcingStrategyConfirmedBy: session.email,
        commercialsApprovedAt: null,
        commercialsApprovedBy: null,
      },
    });
    await writeAuditEvent({
      action: "SUPPLIER_SELECTION_CONFIRMED",
      entityType: "Rfq",
      entityId: rfqId,
      userId: session.id,
      newState: recommendation,
    });
    await writeAuditEvent({
      action: "SUPPLIER_SELECTION_RECOMMENDED",
      entityType: "Rfq",
      entityId: rfqId,
      userId: session.id,
      metadata: { label: "SYSTEM_RECOMMENDATION" },
      newState: recommendation,
    });
  } else {
    // Override: still requires a recommendation payload in form (JSON)
    const raw = String(formData.get("overridePlanJson") ?? "");
    if (!raw) throw new Error("Override plan required");
    const plan = JSON.parse(raw) as typeof recommendation;
    await prisma.rfq.update({
      where: { id: rfqId },
      data: {
        sourcingStrategyType: plan.strategyType,
        sourcingStrategyConfirmed: true,
        sourcingStrategyJson: JSON.stringify({
          ...plan,
          label: "FOUNDER_OVERRIDE",
        }),
        sourcingStrategyConfirmedAt: new Date(),
        sourcingStrategyConfirmedBy: session.email,
        commercialsApprovedAt: null,
      },
    });
    await writeAuditEvent({
      action: "SUPPLIER_SELECTION_OVERRIDDEN",
      entityType: "Rfq",
      entityId: rfqId,
      userId: session.id,
      previousState: recommendation,
      newState: plan,
    });
  }

  revalidatePath(`/rfqs/${rfqId}`);
}

export async function refreshPricingFromQuotesAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "pricing:write")) {
    throw new Error("Not authorised");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  const rfq = await prisma.rfq.findUnique({ where: { id: rfqId } });
  if (!rfq) throw new Error("RFQ not found");
  if (!rfq.sourcingStrategyConfirmed || !rfq.sourcingStrategyJson) {
    throw new Error("Confirm sourcing strategy before refreshing pricing");
  }

  const plan = JSON.parse(rfq.sourcingStrategyJson) as Awaited<
    ReturnType<typeof buildRecommendationForRfq>
  >;

  await refreshRfqPricingFromVerifiedQuotes(prisma, rfqId, {
    actorUserId: session.id,
    actorEmail: session.email,
    confirmedRecommendation: plan,
  });

  revalidatePath(`/rfqs/${rfqId}`);
  revalidatePath("/founder-queue");
}

export async function approveCommercialsAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "approval:founder")) {
    throw new Error("Founder approval required");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: { complianceItems: true },
  });
  if (!rfq) throw new Error("RFQ not found");
  if (rfq.pricingBasis !== "VERIFIED_SUPPLIER") {
    throw new Error("Approve commercials only after verified supplier pricing");
  }
  if (!rfq.sourcingStrategyConfirmed) {
    throw new Error("Sourcing strategy must be confirmed first");
  }

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      commercialsApprovedAt: new Date(),
      commercialsApprovedBy: session.email,
      commercialsRejectedAt: null,
      commercialsRejectionReason: null,
    },
  });

  await writeAuditEvent({
    action: "FOUNDER_COMMERCIALS_APPROVED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    newState: {
      pricingBasis: rfq.pricingBasis,
      note: "Commercial approval only — not READY_TO_SUBMIT while compliance incomplete",
    },
  });

  revalidatePath(`/rfqs/${rfqId}`);
}

export async function rejectCommercialsAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "approval:founder")) {
    throw new Error("Founder approval required");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) throw new Error("Rejection reason required");

  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      commercialsApprovedAt: null,
      commercialsApprovedBy: null,
      commercialsRejectedAt: new Date(),
      commercialsRejectionReason: reason,
    },
  });

  await writeAuditEvent({
    action: "FOUNDER_COMMERCIALS_REJECTED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
    newState: { reason },
  });

  revalidatePath(`/rfqs/${rfqId}`);
}

export async function acceptEligibilityWarningAction(formData: FormData) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "approval:founder")) {
    throw new Error("Founder approval required");
  }
  const rfqId = String(formData.get("rfqId") ?? "");
  await prisma.rfq.update({
    where: { id: rfqId },
    data: {
      eligibilityWarningAcceptedAt: new Date(),
      eligibilityWarningAcceptedBy: session.email,
    },
  });
  await writeAuditEvent({
    action: "ELIGIBILITY_WARNING_ACCEPTED",
    entityType: "Rfq",
    entityId: rfqId,
    userId: session.id,
  });
  revalidatePath(`/rfqs/${rfqId}`);
}

export async function getSubmissionReadinessAction(rfqId: string) {
  const rfq = await prisma.rfq.findUnique({
    where: { id: rfqId },
    include: {
      lineItems: true,
      complianceItems: true,
      pricingScenarios: { where: { isSelected: true }, take: 1 },
    },
  });
  if (!rfq) throw new Error("RFQ not found");

  let eligibilityVerdict: string | null = null;
  try {
    eligibilityVerdict =
      JSON.parse(rfq.companySelectionReason ?? "{}")?.eligibility?.verdict ??
      null;
  } catch {
    eligibilityVerdict = null;
  }

  const compliance = evaluateComplianceGate(rfq.complianceItems);
  const signaturesComplete = !rfq.complianceItems.some(
    (c) =>
      c.isMandatory &&
      (c.itemKey === "signatures" || /signature|MBD/i.test(c.label)) &&
      ["MISSING", "EXPIRED", "NEEDS_SIGNATURE"].includes(c.state),
  );

  return evaluateSubmissionReadiness({
    companySelected: Boolean(rfq.selectedCompanyId),
    eligibilityPassed:
      eligibilityVerdict === "ELIGIBLE" ||
      (eligibilityVerdict === "ELIGIBLE_WITH_WARNING" &&
        Boolean(rfq.eligibilityWarningAcceptedAt)),
    eligibilityWarningAccepted: Boolean(rfq.eligibilityWarningAcceptedAt),
    eligibilityVerdict,
    boqComplete: rfq.lineItems.length > 0,
    verifiedSupplierPricing: rfq.pricingBasis === "VERIFIED_SUPPLIER",
    sourcingStrategyConfirmed: rfq.sourcingStrategyConfirmed,
    commercialsFounderApproved: Boolean(rfq.commercialsApprovedAt),
    mandatoryComplianceComplete: compliance.submissionReady,
    signaturesComplete,
    unresolvedBlockingWarnings: [],
  });
}
