-- Autonomous RFQ Engine V1 lifecycle + research/quotation artifacts.
-- Prep autonomy ON; submission autonomy remains OFF at application layer.

-- CreateTable
CREATE TABLE "ProductResearchCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "rfqLineItemId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "brand" TEXT,
    "modelSku" TEXT,
    "productUrl" TEXT,
    "price" DECIMAL,
    "priceKnown" BOOLEAN NOT NULL DEFAULT false,
    "vatTreatment" TEXT,
    "packSize" DECIMAL,
    "packUnit" TEXT,
    "effectiveUnitCost" DECIMAL,
    "availability" TEXT,
    "deliveryCost" DECIMAL,
    "deliveryKnown" BOOLEAN NOT NULL DEFAULT false,
    "evidenceLevel" TEXT NOT NULL DEFAULT 'PUBLIC_PRICE_REFERENCE',
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidenceAgeHours" REAL,
    "rawEvidenceJson" TEXT,
    "matchVerdict" TEXT NOT NULL DEFAULT 'INSUFFICIENT_INFORMATION',
    "matchConfidence" REAL,
    "matchReasoning" TEXT,
    "matchedAttributes" TEXT,
    "missingAttributes" TEXT,
    "conflictingAttributes" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "unresolved" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductResearchCandidate_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductResearchCandidate_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RfqLineItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutonomousQuotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "quotationNumber" TEXT NOT NULL,
    "companyLegalName" TEXT NOT NULL,
    "companyId" TEXT,
    "institution" TEXT NOT NULL,
    "rfqReference" TEXT,
    "quotationDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validityDays" INTEGER,
    "validityUntil" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "linesJson" TEXT NOT NULL,
    "subtotalExVat" DECIMAL NOT NULL,
    "vatAmount" DECIMAL NOT NULL DEFAULT 0,
    "deliveryAmount" DECIMAL NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL NOT NULL,
    "vatRegistered" BOOLEAN NOT NULL,
    "commercialNotes" TEXT,
    "customerFacingJson" TEXT NOT NULL,
    "internalSnapshotJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutonomousQuotation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable Rfq autonomous lifecycle columns
ALTER TABLE "Rfq" ADD COLUMN "autonomousState" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousOutcome" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousStartedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "autonomousCompletedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "autonomousDurationMs" INTEGER;
ALTER TABLE "Rfq" ADD COLUMN "autonomousFailureReason" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousRetryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Rfq" ADD COLUMN "autonomousConfidence" REAL;
ALTER TABLE "Rfq" ADD COLUMN "autonomousWorkerVersion" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousLastStep" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousClaimToken" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "autonomousClaimExpiresAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "autonomousRunJson" TEXT;

-- AlterTable SystemSettings autonomy flags
ALTER TABLE "SystemSettings" ADD COLUMN "autonomousPrepEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SystemSettings" ADD COLUMN "autonomousSubmissionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ProductResearchCandidate_rfqId_idx" ON "ProductResearchCandidate"("rfqId");
CREATE INDEX "ProductResearchCandidate_rfqLineItemId_idx" ON "ProductResearchCandidate"("rfqLineItemId");
CREATE INDEX "ProductResearchCandidate_selected_idx" ON "ProductResearchCandidate"("selected");
CREATE INDEX "AutonomousQuotation_rfqId_idx" ON "AutonomousQuotation"("rfqId");
CREATE INDEX "AutonomousQuotation_quotationNumber_idx" ON "AutonomousQuotation"("quotationNumber");
CREATE INDEX "Rfq_autonomousState_idx" ON "Rfq"("autonomousState");
CREATE INDEX "Rfq_autonomousOutcome_idx" ON "Rfq"("autonomousOutcome");
CREATE INDEX "Rfq_autonomousClaimExpiresAt_idx" ON "Rfq"("autonomousClaimExpiresAt");
