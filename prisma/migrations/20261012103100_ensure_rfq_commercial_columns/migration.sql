-- Ensure Rfq commercial columns exist (for databases that applied the interrupted quote migration).
-- Safe on greenfield: adds columns. On already-patched DBs this migration is marked applied without re-run.

ALTER TABLE "Rfq" ADD COLUMN "sourcingStrategyType" TEXT NOT NULL DEFAULT 'UNDECIDED';
ALTER TABLE "Rfq" ADD COLUMN "sourcingStrategyConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Rfq" ADD COLUMN "sourcingStrategyJson" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "sourcingStrategyConfirmedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "sourcingStrategyConfirmedBy" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "commercialsApprovedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "commercialsApprovedBy" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "commercialsRejectedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "commercialsRejectionReason" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "eligibilityWarningAcceptedAt" DATETIME;
ALTER TABLE "Rfq" ADD COLUMN "eligibilityWarningAcceptedBy" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "pricingBasis" TEXT NOT NULL DEFAULT 'PROVISIONAL';
