import fs from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { sha256Buffer, shouldReprocessDocument } from "@/domain/documentHash";
import { extractRfqDocument } from "@/domain/extraction";
import { writeAuditEvent } from "@/lib/audit";

const STORAGE_ROOT = path.join(process.cwd(), "storage", "documents");

async function loadPdfParse() {
  // Avoid pdf-parse package root side-effect
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  return (mod.default ?? mod) as (buf: Buffer) => Promise<{
    text: string;
    numpages: number;
  }>;
}

export type IngestResult = {
  documentId: string;
  action: "DOWNLOADED" | "SKIPPED_UNCHANGED" | "EXTRACTED" | "FAILED";
  contentHash?: string;
  lineItemsCreated?: number;
  warnings?: string[];
  error?: string;
};

export async function retrieveAndExtractDocument(
  prisma: PrismaClient,
  documentId: string,
  options?: { force?: boolean; verifyLineItems?: boolean },
): Promise<IngestResult> {
  const doc = await prisma.rfqDocument.findUnique({
    where: { id: documentId },
    include: { rfq: true },
  });
  if (!doc) throw new Error("Document not found");
  if (!doc.sourceUrl) {
    return { documentId, action: "FAILED", error: "No sourceUrl" };
  }

  await fs.mkdir(STORAGE_ROOT, { recursive: true });

  const response = await fetch(doc.sourceUrl, {
    headers: { "User-Agent": "BiddifyLocalDocFetch/1.0", Accept: "*/*" },
    cache: "no-store",
  });
  if (!response.ok) {
    await prisma.rfqDocument.update({
      where: { id: documentId },
      data: { processingState: "FAILED", notes: `Download HTTP ${response.status}` },
    });
    return { documentId, action: "FAILED", error: `HTTP ${response.status}` };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = sha256Buffer(buffer);

  if (!options?.force && !shouldReprocessDocument(doc.contentHash, hash)) {
    await prisma.rfqDocument.update({
      where: { id: documentId },
      data: {
        processingState: "SKIPPED_UNCHANGED",
        retrievedAt: new Date(),
        byteSize: buffer.length,
      },
    });
    return { documentId, action: "SKIPPED_UNCHANGED", contentHash: hash };
  }

  const localName = `${doc.rfqId}_${hash.slice(0, 16)}_${doc.fileName.replace(/[^\w.\-]+/g, "_")}`;
  const localPath = path.join(STORAGE_ROOT, localName);
  await fs.writeFile(localPath, buffer);

  await prisma.rfqDocument.update({
    where: { id: documentId },
    data: {
      contentHash: hash,
      byteSize: buffer.length,
      localPath: path.relative(process.cwd(), localPath),
      retrievedAt: new Date(),
      processingState: "DOWNLOADED",
      storageKey: localName,
    },
  });

  await writeAuditEvent(
    {
      action: "DOCUMENT_RETRIEVED",
      entityType: "RfqDocument",
      entityId: documentId,
      metadata: { hash, bytes: buffer.length },
    },
    prisma,
  );

  if ((doc.format || "").toLowerCase() !== "pdf" && !doc.fileName.toLowerCase().endsWith(".pdf")) {
    return { documentId, action: "DOWNLOADED", contentHash: hash, warnings: ["Non-PDF — extraction skipped"] };
  }

  const pdf = await loadPdfParse();
  const parsed = await pdf(buffer);
  const extraction = extractRfqDocument(parsed.text, {
    buyer: doc.rfq.buyer,
    title: doc.rfq.title,
  });

  // Replace prior extracted lines for this document only
  await prisma.rfqLineItem.deleteMany({
    where: { rfqId: doc.rfqId, sourceDocumentId: documentId },
  });

  for (const item of extraction.lineItems) {
    await prisma.rfqLineItem.create({
      data: {
        rfqId: doc.rfqId,
        lineNumber: item.lineNumber,
        product: item.materialNumber,
        description: item.description,
        specification: item.specification,
        brandRequirement: item.brandRequirement,
        brand: item.brandRequirement,
        quantity: item.quantity,
        unit: item.unit,
        equivalentAllowed: item.equivalentAllowed,
        mandatoryCharacteristics: item.mandatoryCharacteristics,
        deliveryDestination: extraction.deliveryDestination,
        verificationStatus: options?.verifyLineItems ? "VERIFIED" : "UNVERIFIED",
        extractionMethod: item.extractionMethod,
        extractionConfidence: item.confidence,
        sourceDocumentId: documentId,
        sourcePage: item.sourcePage,
        sourceSection: item.sourceSection,
        notes: item.materialNumber ? `Material no. ${item.materialNumber}` : undefined,
      },
    });
  }

  for (const req of extraction.requirements) {
    const existing = await prisma.rfqRequirement.findFirst({
      where: {
        rfqId: doc.rfqId,
        description: req.description,
      },
    });
    if (!existing) {
      await prisma.rfqRequirement.create({
        data: {
          rfqId: doc.rfqId,
          category: req.category,
          requirementType: req.requirementType,
          description: req.description,
          isMandatory: req.isMandatory,
          provenance: req.provenance,
          sourceDocument: doc.fileName,
          sourcePage: req.sourcePage ?? req.sourceSection,
          verificationStatus: "UNVERIFIED",
          notes: req.notes,
        },
      });
    }
  }

  if (extraction.deliveryAddress) {
    await prisma.rfq.update({
      where: { id: doc.rfqId },
      data: {
        deliveryAddress: extraction.deliveryAddress,
        briefingCompulsoryKnown: true,
        briefingCompulsory: false,
      },
    });
  }

  await prisma.rfqDocument.update({
    where: { id: documentId },
    data: {
      extractedAt: new Date(),
      pageCount: parsed.numpages,
      extractedText: parsed.text.slice(0, 100_000),
      processingState: "EXTRACTED",
      notes: extraction.warnings.join(" | ") || doc.notes,
    },
  });

  await writeAuditEvent(
    {
      action: "DOCUMENT_EXTRACTED",
      entityType: "RfqDocument",
      entityId: documentId,
      metadata: {
        method: extraction.method,
        lineItems: extraction.lineItems.length,
        warnings: extraction.warnings,
      },
    },
    prisma,
  );

  return {
    documentId,
    action: "EXTRACTED",
    contentHash: hash,
    lineItemsCreated: extraction.lineItems.length,
    warnings: extraction.warnings,
  };
}
