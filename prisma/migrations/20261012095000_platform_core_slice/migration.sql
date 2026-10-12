-- CreateEnum
-- SourcingLifecycleStatus

-- AlterTable
ALTER TABLE "ComplianceRequirement" ADD COLUMN "evidenceSource" TEXT;

-- CreateIndex (unique rfqId+itemKey) — SQLite: recreate unique via index
CREATE UNIQUE INDEX IF NOT EXISTS "ComplianceRequirement_rfqId_itemKey_key" ON "ComplianceRequirement"("rfqId", "itemKey");

-- AlterTable
ALTER TABLE "SourcingRequest" ADD COLUMN "lifecycleStatus" TEXT NOT NULL DEFAULT 'DRAFT';
