-- Complete remaining columns from interrupted apply.
-- Rfq commercial/sourcing columns already present on this database.

ALTER TABLE "SupplierQuote" ADD COLUMN "capturedAt" DATETIME;
ALTER TABLE "SupplierQuote" ADD COLUMN "verifiedBy" TEXT;
ALTER TABLE "SupplierQuote" ADD COLUMN "verifiedAt" DATETIME;
ALTER TABLE "SupplierQuote" ADD COLUMN "rejectedBy" TEXT;
ALTER TABLE "SupplierQuote" ADD COLUMN "rejectedAt" DATETIME;
ALTER TABLE "SupplierQuote" ADD COLUMN "rejectionReason" TEXT;

UPDATE "SupplierQuote" SET "capturedAt" = "createdAt" WHERE "capturedAt" IS NULL;

ALTER TABLE "SupplierQuoteLineItem" ADD COLUMN "unit" TEXT;
ALTER TABLE "SupplierQuoteLineItem" ADD COLUMN "vatTreatment" TEXT;
ALTER TABLE "SupplierQuoteLineItem" ADD COLUMN "manufacturer" TEXT;
ALTER TABLE "SupplierQuoteLineItem" ADD COLUMN "specificationNotes" TEXT;
ALTER TABLE "SupplierQuoteLineItem" ADD COLUMN "complianceNotes" TEXT;

ALTER TABLE "PricingScenario" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PricingScenario" ADD COLUMN "previousScenarioId" TEXT;
ALTER TABLE "PricingScenario" ADD COLUMN "pricingBasis" TEXT NOT NULL DEFAULT 'PROVISIONAL';
ALTER TABLE "PricingScenario" ADD COLUMN "evidenceQuoteIds" TEXT;

CREATE INDEX IF NOT EXISTS "SupplierQuote_verificationState_idx" ON "SupplierQuote"("verificationState");
CREATE INDEX IF NOT EXISTS "PricingScenario_previousScenarioId_idx" ON "PricingScenario"("previousScenarioId");
