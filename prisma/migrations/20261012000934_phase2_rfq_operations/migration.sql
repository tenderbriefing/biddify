-- AlterTable
ALTER TABLE "RfqDocument" ADD COLUMN "format" TEXT;
ALTER TABLE "RfqDocument" ADD COLUMN "sourceUrl" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Rfq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceOpportunityId" TEXT,
    "sourceReference" TEXT,
    "tenderNumber" TEXT,
    "ocid" TEXT,
    "buyer" TEXT NOT NULL,
    "department" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "province" TEXT,
    "municipality" TEXT,
    "deliveryAddress" TEXT,
    "publicationDate" DATETIME,
    "sourcePublishedAt" DATETIME,
    "sourceLastModifiedAt" DATETIME,
    "importedAt" DATETIME,
    "rawSourceMetadata" TEXT,
    "briefingDate" DATETIME,
    "briefingCompulsory" BOOLEAN NOT NULL DEFAULT false,
    "briefingCompulsoryKnown" BOOLEAN NOT NULL DEFAULT false,
    "questionsDeadline" DATETIME,
    "closingAt" DATETIME NOT NULL,
    "closingTimeKnown" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "submissionMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "submissionEmail" TEXT,
    "submissionPortal" TEXT,
    "physicalSubmission" TEXT,
    "estimatedValue" DECIMAL,
    "contractDuration" TEXT,
    "deliveryPeriod" TEXT,
    "paymentTerms" TEXT,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "opportunityScore" INTEGER,
    "commercialScore" INTEGER,
    "complianceScore" INTEGER,
    "profitabilityGate" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "opportunityScoreNotes" TEXT,
    "opportunityScoreBreakdown" TEXT,
    "classification" TEXT,
    "classificationConfidence" REAL,
    "classificationReasoning" TEXT,
    "classificationSource" TEXT,
    "classificationOverride" TEXT,
    "qualificationGate" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "qualificationReasons" TEXT,
    "qualificationSnapshot" TEXT,
    "qualificationOverride" TEXT,
    "nextAction" TEXT,
    "nextActionReason" TEXT,
    "noBidReason" TEXT,
    "noBidCategory" TEXT,
    "noBidNotes" TEXT,
    "noBidDecidedAt" DATETIME,
    "selectedCompanyId" TEXT,
    "duplicateOfId" TEXT,
    "duplicateGroupId" TEXT,
    "isRealSource" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rfq_selectedCompanyId_fkey" FOREIGN KEY ("selectedCompanyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rfq_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Rfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Rfq" ("briefingCompulsory", "briefingDate", "buyer", "category", "closingAt", "commercialScore", "complianceScore", "contractDuration", "createdAt", "deliveryAddress", "deliveryPeriod", "department", "description", "duplicateOfId", "estimatedValue", "id", "internalId", "isDemo", "municipality", "noBidReason", "opportunityScore", "opportunityScoreNotes", "paymentTerms", "physicalSubmission", "profitabilityGate", "province", "publicationDate", "questionsDeadline", "selectedCompanyId", "source", "sourceReference", "sourceUrl", "status", "submissionEmail", "submissionMethod", "submissionPortal", "tenderNumber", "timezone", "title", "updatedAt") SELECT "briefingCompulsory", "briefingDate", "buyer", "category", "closingAt", "commercialScore", "complianceScore", "contractDuration", "createdAt", "deliveryAddress", "deliveryPeriod", "department", "description", "duplicateOfId", "estimatedValue", "id", "internalId", "isDemo", "municipality", "noBidReason", "opportunityScore", "opportunityScoreNotes", "paymentTerms", "physicalSubmission", "profitabilityGate", "province", "publicationDate", "questionsDeadline", "selectedCompanyId", "source", "sourceReference", "sourceUrl", "status", "submissionEmail", "submissionMethod", "submissionPortal", "tenderNumber", "timezone", "title", "updatedAt" FROM "Rfq";
DROP TABLE "Rfq";
ALTER TABLE "new_Rfq" RENAME TO "Rfq";
CREATE UNIQUE INDEX "Rfq_internalId_key" ON "Rfq"("internalId");
CREATE INDEX "Rfq_status_idx" ON "Rfq"("status");
CREATE INDEX "Rfq_closingAt_idx" ON "Rfq"("closingAt");
CREATE INDEX "Rfq_selectedCompanyId_idx" ON "Rfq"("selectedCompanyId");
CREATE INDEX "Rfq_isRealSource_idx" ON "Rfq"("isRealSource");
CREATE INDEX "Rfq_classification_idx" ON "Rfq"("classification");
CREATE INDEX "Rfq_nextAction_idx" ON "Rfq"("nextAction");
CREATE INDEX "Rfq_duplicateGroupId_idx" ON "Rfq"("duplicateGroupId");
CREATE UNIQUE INDEX "Rfq_source_sourceOpportunityId_key" ON "Rfq"("source", "sourceOpportunityId");
CREATE TABLE "new_RfqRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "requirementType" TEXT,
    "description" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sourceHint" TEXT,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "provenance" TEXT NOT NULL DEFAULT 'HEURISTIC',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqRequirement_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RfqRequirement" ("category", "createdAt", "description", "id", "isMandatory", "rfqId", "sourceHint", "updatedAt") SELECT "category", "createdAt", "description", "id", "isMandatory", "rfqId", "sourceHint", "updatedAt" FROM "RfqRequirement";
DROP TABLE "RfqRequirement";
ALTER TABLE "new_RfqRequirement" RENAME TO "RfqRequirement";
CREATE INDEX "RfqRequirement_rfqId_idx" ON "RfqRequirement"("rfqId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
