/**
 * Manual supplier quotation capture — evidenceType always SUPPLIER_QUOTE.
 * Starts as EXTRACTED_UNVERIFIED or UNVERIFIED until Founder verifies.
 * Never marks email SENT.
 */
import type { PrismaClient, SpecMatchState, SupplierVatStatus } from "@prisma/client";
import { writeAuditEvent } from "@/lib/audit";
import { evaluateSpecMatch } from "@/domain/specMatch";

export type ManualQuoteLineInput = {
  rfqLineItemId: string;
  description: string;
  quantity: number;
  unit?: string | null;
  unitCost: number | null;
  brandOffered?: string | null;
  manufacturer?: string | null;
  sku?: string | null;
  modelOffered?: string | null;
  availability?: string | null;
  vatTreatment?: string | null;
  specificationNotes?: string | null;
  complianceNotes?: string | null;
  matchState?: SpecMatchState;
};

export type ManualQuoteCaptureInput = {
  rfqId: string;
  supplierId: string;
  quoteReference?: string | null;
  quoteDate?: Date | null;
  validUntil?: Date | null;
  contactPerson?: string | null;
  supplierEmail?: string | null;
  supplierVatStatus?: SupplierVatStatus;
  deliveryCost?: number | null;
  deliveryKnown: boolean;
  deliveryLocation?: string | null;
  deliveryTerms?: string | null;
  leadTimeDays?: number | null;
  paymentTerms?: string | null;
  vatIncluded?: boolean | null;
  vatKnown: boolean;
  sourceReference?: string | null;
  sourceDocumentPath?: string | null;
  notes?: string | null;
  capturedBy: string;
  lines: ManualQuoteLineInput[];
  /** If true, start as EXTRACTED_UNVERIFIED (from upload parse). */
  fromExtraction?: boolean;
};

export async function captureManualSupplierQuote(
  prisma: PrismaClient,
  input: ManualQuoteCaptureInput,
) {
  const rfq = await prisma.rfq.findUnique({
    where: { id: input.rfqId },
    include: { lineItems: true },
  });
  if (!rfq) throw new Error("RFQ not found");

  const supplier = await prisma.supplier.findUnique({
    where: { id: input.supplierId },
  });
  if (!supplier || supplier.isDemo) {
    throw new Error("Operational supplier required");
  }

  let subtotal = 0;
  let allPriced = true;
  const lineCreates = [];

  for (const line of input.lines) {
    const boq = rfq.lineItems.find((l) => l.id === line.rfqLineItemId);
    if (!boq) throw new Error(`BOQ line not found: ${line.rfqLineItemId}`);

    const matchState =
      line.matchState ??
      evaluateSpecMatch({
        rfqDescription: boq.description,
        rfqBrand: boq.brandRequirement,
        equivalentAllowed: boq.equivalentAllowed,
        offeredDescription: line.description,
        offeredBrand: line.brandOffered ?? line.manufacturer,
      });

    if (line.unitCost == null) {
      allPriced = false;
      lineCreates.push({
        rfqLineItemId: line.rfqLineItemId,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit ?? boq.unit,
        unitCost: null,
        priceKnown: false,
        lineTotal: null,
        brandOffered: line.brandOffered,
        manufacturer: line.manufacturer,
        sku: line.sku,
        modelOffered: line.modelOffered,
        availability: line.availability,
        vatTreatment: line.vatTreatment,
        specificationNotes: line.specificationNotes,
        complianceNotes: line.complianceNotes,
        matchState,
      });
      continue;
    }

    const lineTotal =
      Math.round(line.quantity * line.unitCost * 100 + Number.EPSILON) / 100;
    subtotal += lineTotal;
    lineCreates.push({
      rfqLineItemId: line.rfqLineItemId,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? boq.unit,
      unitCost: line.unitCost,
      priceKnown: true,
      lineTotal,
      brandOffered: line.brandOffered,
      manufacturer: line.manufacturer,
      sku: line.sku,
      modelOffered: line.modelOffered,
      availability: line.availability,
      vatTreatment: line.vatTreatment,
      specificationNotes: line.specificationNotes,
      complianceNotes: line.complianceNotes,
      matchState,
    });
  }

  subtotal = Math.round(subtotal * 100) / 100;
  const vatAmount =
    input.vatKnown && input.vatIncluded === false && allPriced
      ? null // exclusive — VAT amount unknown unless provided
      : null;

  const coveredIds = new Set(input.lines.map((l) => l.rfqLineItemId));
  const isComplete =
    rfq.lineItems.every((l) => coveredIds.has(l.id)) &&
    allPriced &&
    input.deliveryKnown;

  const quote = await prisma.supplierQuote.create({
    data: {
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      quoteReference: input.quoteReference,
      quoteDate: input.quoteDate,
      validUntil: input.validUntil,
      contactPerson: input.contactPerson,
      supplierEmail: input.supplierEmail,
      supplierVatStatus: input.supplierVatStatus ?? "UNKNOWN",
      deliveryCost: input.deliveryKnown ? input.deliveryCost : null,
      deliveryKnown: input.deliveryKnown,
      deliveryLocation: input.deliveryLocation,
      deliveryTerms: input.deliveryTerms,
      leadTimeDays: input.leadTimeDays,
      paymentTerms: input.paymentTerms,
      vatIncluded: input.vatKnown ? input.vatIncluded : null,
      vatKnown: input.vatKnown,
      subtotal: allPriced ? subtotal : null,
      vatAmount,
      totalAmount:
        allPriced && input.deliveryKnown && input.deliveryCost != null
          ? Math.round((subtotal + input.deliveryCost) * 100) / 100
          : null,
      evidenceType: "SUPPLIER_QUOTE",
      verificationState: input.fromExtraction
        ? "EXTRACTED_UNVERIFIED"
        : "UNVERIFIED",
      sourceDocumentPath: input.sourceDocumentPath,
      sourceReference: input.sourceReference,
      captureMethod: input.fromExtraction ? "UPLOAD_EXTRACT" : "MANUAL",
      capturedBy: input.capturedBy,
      capturedAt: new Date(),
      notes: input.notes,
      isComplete,
      isDemo: false,
      lineItems: { create: lineCreates },
    },
    include: { lineItems: true, supplier: true },
  });

  // Link sourcing request lifecycle if matching supplier draft exists
  await prisma.sourcingRequest.updateMany({
    where: {
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      deliveryState: { in: ["DRAFT_NOT_SENT", "READY_TO_SEND", "HELD"] },
    },
    data: {
      lifecycleStatus: "QUOTE_RECEIVED_MANUALLY",
      // never SENT
      deliveryState: "DRAFT_NOT_SENT",
    },
  });

  // Soft-touch compliance: formal supplier quotation available (not MBDs/signatures)
  await prisma.complianceRequirement.updateMany({
    where: {
      rfqId: input.rfqId,
      itemKey: { in: ["pricing_schedule"] },
      state: "MISSING",
    },
    data: {
      notes: "Supplier quotation captured — verify before treating as complete pricing",
    },
  });

  await writeAuditEvent({
    action: "SUPPLIER_QUOTE_CAPTURED",
    entityType: "SupplierQuote",
    entityId: quote.id,
    metadata: {
      rfqId: input.rfqId,
      supplierId: input.supplierId,
      evidenceType: "SUPPLIER_QUOTE",
      verificationState: quote.verificationState,
      lineCount: lineCreates.length,
      isComplete,
    },
  });

  return quote;
}

export async function verifySupplierQuote(
  prisma: PrismaClient,
  quoteId: string,
  verifiedBy: string,
) {
  const quote = await prisma.supplierQuote.findUnique({
    where: { id: quoteId },
    include: { lineItems: true },
  });
  if (!quote) throw new Error("Quote not found");
  if (quote.evidenceType !== "SUPPLIER_QUOTE") {
    throw new Error("Only SUPPLIER_QUOTE records can be verified as supplier quotations");
  }
  if (quote.verificationState === "REJECTED") {
    throw new Error("Rejected quote cannot be verified — capture a new quote");
  }

  const updated = await prisma.supplierQuote.update({
    where: { id: quoteId },
    data: {
      verificationState: "VERIFIED",
      verifiedBy,
      verifiedAt: new Date(),
    },
  });

  await writeAuditEvent({
    action: "SUPPLIER_QUOTE_VERIFIED",
    entityType: "SupplierQuote",
    entityId: quoteId,
    previousState: { verificationState: quote.verificationState },
    newState: { verificationState: "VERIFIED", verifiedBy },
  });

  return updated;
}

export async function rejectSupplierQuote(
  prisma: PrismaClient,
  quoteId: string,
  rejectedBy: string,
  reason: string,
) {
  const quote = await prisma.supplierQuote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new Error("Quote not found");

  const updated = await prisma.supplierQuote.update({
    where: { id: quoteId },
    data: {
      verificationState: "REJECTED",
      rejectedBy,
      rejectedAt: new Date(),
      rejectionReason: reason,
    },
  });

  await writeAuditEvent({
    action: "SUPPLIER_QUOTE_REJECTED",
    entityType: "SupplierQuote",
    entityId: quoteId,
    previousState: { verificationState: quote.verificationState },
    newState: { verificationState: "REJECTED", reason },
  });

  return updated;
}
