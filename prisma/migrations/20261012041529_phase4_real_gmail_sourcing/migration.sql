/*
  Warnings:

  - You are about to drop the column `body` on the `EmailMessage` table. All the data in the column will be lost.
  - You are about to drop the column `recipient` on the `EmailMessage` table. All the data in the column will be lost.
  - Added the required column `recipients` to the `EmailMessage` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailMessageId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "byteSize" INTEGER,
    "contentHash" TEXT,
    "localPath" TEXT,
    "storageKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailAttachment_emailMessageId_fkey" FOREIGN KEY ("emailMessageId") REFERENCES "EmailMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "emailAddress" TEXT NOT NULL,
    "googleAccountId" TEXT,
    "companyId" TEXT,
    "connectionStatus" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "scopesGranted" TEXT,
    "sendingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "receivingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mappedAt" DATETIME,
    "mappingConfirmedBy" TEXT,
    "lastSuccessfulSync" DATETIME,
    "lastFailedSync" DATETIME,
    "syncError" TEXT,
    "labelBiddifyId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GmailAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GmailToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailAccountId" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "tokenExpiry" DATETIME,
    "encryptionVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GmailToken_gmailAccountId_fkey" FOREIGN KEY ("gmailAccountId") REFERENCES "GmailAccount" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SourcingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "gmailAccountId" TEXT,
    "enquiryId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'FORMAL_SUPPLIER_QUOTE_REQUIRED',
    "deliveryState" TEXT NOT NULL DEFAULT 'DRAFT_NOT_SENT',
    "certificationBatch" BOOLEAN NOT NULL DEFAULT false,
    "founderApprovedAt" DATETIME,
    "founderApprovedBy" TEXT,
    "sentAt" DATETIME,
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "followUpCount" INTEGER NOT NULL DEFAULT 0,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 2,
    "nextFollowUpAt" DATETIME,
    "stopReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SourcingRequest_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SourcingRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourcingRequest_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SourcingRequest_gmailAccountId_fkey" FOREIGN KEY ("gmailAccountId") REFERENCES "GmailAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierSuppression" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "email" TEXT,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" DATETIME,
    CONSTRAINT "SupplierSuppression_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SystemSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "outboundMode" TEXT NOT NULL DEFAULT 'DISABLED',
    "globalOutboundPaused" BOOLEAN NOT NULL DEFAULT true,
    "certificationPassedAt" DATETIME,
    "autonomyAuthorisedAt" DATETIME,
    "autonomyAuthorisedBy" TEXT,
    "maxEmailsPerHour" INTEGER NOT NULL DEFAULT 10,
    "maxEmailsPerDay" INTEGER NOT NULL DEFAULT 40,
    "maxEmailsPerSupplierPerDay" INTEGER NOT NULL DEFAULT 2,
    "maxEmailsPerCompanyPerDay" INTEGER NOT NULL DEFAULT 20,
    "supplierCooldownHours" INTEGER NOT NULL DEFAULT 72,
    "maxFollowUps" INTEGER NOT NULL DEFAULT 2,
    "totalProcurementCapitalLimit" DECIMAL,
    "notes" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CompanyCapitalLimit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "capitalLimit" DECIMAL NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "csdNumber" TEXT,
    "csdMaaaNumber" TEXT,
    "taxNumber" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
    "vatStatusKnown" BOOLEAN NOT NULL DEFAULT false,
    "vatNumber" TEXT,
    "beeLevel" TEXT,
    "beeExpiry" DATETIME,
    "bankName" TEXT,
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankBranchCode" TEXT,
    "physicalAddress" TEXT,
    "postalAddress" TEXT,
    "province" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "commodityNotes" TEXT,
    "commodityCategories" TEXT,
    "geographicCoverage" TEXT,
    "capabilities" TEXT,
    "restrictions" TEXT,
    "relatedCompanyGroupId" TEXT,
    "relatedCompanyNotes" TEXT,
    "evidenceSource" TEXT,
    "readinessOverall" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "readinessDetails" TEXT,
    "outboundSourcingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "dataMode" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Company" ("bankAccountName", "bankAccountNumber", "bankBranchCode", "bankName", "beeExpiry", "beeLevel", "commodityNotes", "contactEmail", "contactName", "contactPhone", "createdAt", "csdNumber", "geographicCoverage", "id", "isActive", "isDemo", "legalName", "notes", "physicalAddress", "postalAddress", "province", "registrationNumber", "restrictions", "taxNumber", "tradingName", "updatedAt", "vatNumber", "vatRegistered") SELECT "bankAccountName", "bankAccountNumber", "bankBranchCode", "bankName", "beeExpiry", "beeLevel", "commodityNotes", "contactEmail", "contactName", "contactPhone", "createdAt", "csdNumber", "geographicCoverage", "id", "isActive", "isDemo", "legalName", "notes", "physicalAddress", "postalAddress", "province", "registrationNumber", "restrictions", "taxNumber", "tradingName", "updatedAt", "vatNumber", "vatRegistered" FROM "Company";
DROP TABLE "Company";
ALTER TABLE "new_Company" RENAME TO "Company";
CREATE INDEX "Company_isDemo_idx" ON "Company"("isDemo");
CREATE INDEX "Company_dataMode_idx" ON "Company"("dataMode");
CREATE INDEX "Company_relatedCompanyGroupId_idx" ON "Company"("relatedCompanyGroupId");
CREATE TABLE "new_CompanyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issueDate" DATETIME,
    "expiryDate" DATETIME,
    "version" TEXT,
    "verificationState" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "storageKey" TEXT,
    "localPath" TEXT,
    "contentHash" TEXT,
    "sourcePath" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CompanyDocument" ("companyId", "createdAt", "documentType", "expiryDate", "id", "isDemo", "issueDate", "notes", "storageKey", "title", "updatedAt", "verificationState", "version") SELECT "companyId", "createdAt", "documentType", "expiryDate", "id", "isDemo", "issueDate", "notes", "storageKey", "title", "updatedAt", "verificationState", "version" FROM "CompanyDocument";
DROP TABLE "CompanyDocument";
ALTER TABLE "new_CompanyDocument" RENAME TO "CompanyDocument";
CREATE INDEX "CompanyDocument_companyId_idx" ON "CompanyDocument"("companyId");
CREATE INDEX "CompanyDocument_contentHash_idx" ON "CompanyDocument"("contentHash");
CREATE TABLE "new_EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailAccountId" TEXT,
    "companyId" TEXT,
    "rfqId" TEXT,
    "supplierId" TEXT,
    "sourcingRequestId" TEXT,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "gmailMessageId" TEXT,
    "gmailThreadId" TEXT,
    "sender" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "cc" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT,
    "bodyHtml" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "classificationConfidence" REAL,
    "processingState" TEXT NOT NULL DEFAULT 'PENDING',
    "deliveryState" TEXT NOT NULL DEFAULT 'DRAFT',
    "workflow" TEXT,
    "idempotencyKey" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT false,
    "isRelevant" BOOLEAN NOT NULL DEFAULT true,
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailMessage_gmailAccountId_fkey" FOREIGN KEY ("gmailAccountId") REFERENCES "GmailAccount" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailMessage_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailMessage_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailMessage_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EmailMessage" ("companyId", "createdAt", "deliveryState", "id", "isMock", "rfqId", "sender", "sentAt", "subject", "updatedAt", "workflow") SELECT "companyId", "createdAt", "deliveryState", "id", "isMock", "rfqId", "sender", "sentAt", "subject", "updatedAt", "workflow" FROM "EmailMessage";
DROP TABLE "EmailMessage";
ALTER TABLE "new_EmailMessage" RENAME TO "EmailMessage";
CREATE UNIQUE INDEX "EmailMessage_idempotencyKey_key" ON "EmailMessage"("idempotencyKey");
CREATE INDEX "EmailMessage_rfqId_idx" ON "EmailMessage"("rfqId");
CREATE INDEX "EmailMessage_gmailThreadId_idx" ON "EmailMessage"("gmailThreadId");
CREATE INDEX "EmailMessage_gmailMessageId_idx" ON "EmailMessage"("gmailMessageId");
CREATE INDEX "EmailMessage_companyId_idx" ON "EmailMessage"("companyId");
CREATE INDEX "EmailMessage_supplierId_idx" ON "EmailMessage"("supplierId");
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
    "dataMode" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "recommendedCompanyId" TEXT,
    "companySelectionReason" TEXT,
    "companySelectionBlockers" TEXT,
    "sourcingStrategy" TEXT,
    "sourcingHold" BOOLEAN NOT NULL DEFAULT false,
    "sourcingStopReason" TEXT,
    "costConfidence" INTEGER,
    "costConfidenceReasons" TEXT,
    "specConfidence" INTEGER,
    "specConfidenceReasons" TEXT,
    "bidPriority" INTEGER,
    "bidPriorityReasons" TEXT,
    "capitalEfficiency" REAL,
    "fundingRequired" BOOLEAN NOT NULL DEFAULT false,
    "inFounderBidQueue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rfq_selectedCompanyId_fkey" FOREIGN KEY ("selectedCompanyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rfq_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Rfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Rfq" ("briefingCompulsory", "briefingCompulsoryKnown", "briefingDate", "buyer", "category", "classification", "classificationConfidence", "classificationOverride", "classificationReasoning", "classificationSource", "closingAt", "closingTimeKnown", "commercialScore", "complianceScore", "contractDuration", "createdAt", "deliveryAddress", "deliveryPeriod", "department", "description", "duplicateGroupId", "duplicateOfId", "estimatedValue", "id", "importedAt", "internalId", "isDemo", "isRealSource", "municipality", "nextAction", "nextActionReason", "noBidCategory", "noBidDecidedAt", "noBidNotes", "noBidReason", "ocid", "opportunityScore", "opportunityScoreBreakdown", "opportunityScoreNotes", "paymentTerms", "physicalSubmission", "profitabilityGate", "province", "publicationDate", "qualificationGate", "qualificationOverride", "qualificationReasons", "qualificationSnapshot", "questionsDeadline", "rawSourceMetadata", "selectedCompanyId", "source", "sourceLastModifiedAt", "sourceOpportunityId", "sourcePublishedAt", "sourceReference", "sourceUrl", "status", "submissionEmail", "submissionMethod", "submissionPortal", "tenderNumber", "timezone", "title", "updatedAt") SELECT "briefingCompulsory", "briefingCompulsoryKnown", "briefingDate", "buyer", "category", "classification", "classificationConfidence", "classificationOverride", "classificationReasoning", "classificationSource", "closingAt", "closingTimeKnown", "commercialScore", "complianceScore", "contractDuration", "createdAt", "deliveryAddress", "deliveryPeriod", "department", "description", "duplicateGroupId", "duplicateOfId", "estimatedValue", "id", "importedAt", "internalId", "isDemo", "isRealSource", "municipality", "nextAction", "nextActionReason", "noBidCategory", "noBidDecidedAt", "noBidNotes", "noBidReason", "ocid", "opportunityScore", "opportunityScoreBreakdown", "opportunityScoreNotes", "paymentTerms", "physicalSubmission", "profitabilityGate", "province", "publicationDate", "qualificationGate", "qualificationOverride", "qualificationReasons", "qualificationSnapshot", "questionsDeadline", "rawSourceMetadata", "selectedCompanyId", "source", "sourceLastModifiedAt", "sourceOpportunityId", "sourcePublishedAt", "sourceReference", "sourceUrl", "status", "submissionEmail", "submissionMethod", "submissionPortal", "tenderNumber", "timezone", "title", "updatedAt" FROM "Rfq";
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
CREATE INDEX "Rfq_inFounderBidQueue_idx" ON "Rfq"("inFounderBidQueue");
CREATE INDEX "Rfq_dataMode_idx" ON "Rfq"("dataMode");
CREATE UNIQUE INDEX "Rfq_source_sourceOpportunityId_key" ON "Rfq"("source", "sourceOpportunityId");
CREATE TABLE "new_Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailEvidence" TEXT,
    "telephone" TEXT,
    "categories" TEXT,
    "brands" TEXT,
    "geographicCoverage" TEXT,
    "paymentTerms" TEXT,
    "deliveryCapability" TEXT,
    "reliabilityNotes" TEXT,
    "responseSpeedNotes" TEXT,
    "notes" TEXT,
    "supplierType" TEXT,
    "discoverySource" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "evidenceUrl" TEXT,
    "location" TEXT,
    "suppressionReason" TEXT,
    "suppressedAt" DATETIME,
    "suppressionNotes" TEXT,
    "rfqsRequestedCount" INTEGER NOT NULL DEFAULT 0,
    "responsesCount" INTEGER NOT NULL DEFAULT 0,
    "quotesCount" INTEGER NOT NULL DEFAULT 0,
    "lastContactedAt" DATETIME,
    "medianResponseHours" REAL,
    "scoreBreakdown" TEXT,
    "scoreTotal" REAL,
    "dataMode" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Supplier" ("brands", "categories", "createdAt", "deliveryCapability", "discoverySource", "email", "evidenceUrl", "geographicCoverage", "id", "isActive", "isDemo", "location", "name", "notes", "paymentTerms", "reliabilityNotes", "responseSpeedNotes", "supplierType", "telephone", "updatedAt", "verificationStatus", "website") SELECT "brands", "categories", "createdAt", "deliveryCapability", "discoverySource", "email", "evidenceUrl", "geographicCoverage", "id", "isActive", "isDemo", "location", "name", "notes", "paymentTerms", "reliabilityNotes", "responseSpeedNotes", "supplierType", "telephone", "updatedAt", "verificationStatus", "website" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE INDEX "Supplier_isDemo_idx" ON "Supplier"("isDemo");
CREATE INDEX "Supplier_email_idx" ON "Supplier"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EmailAttachment_emailMessageId_idx" ON "EmailAttachment"("emailMessageId");

-- CreateIndex
CREATE INDEX "EmailAttachment_contentHash_idx" ON "EmailAttachment"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_emailAddress_key" ON "GmailAccount"("emailAddress");

-- CreateIndex
CREATE INDEX "GmailAccount_companyId_idx" ON "GmailAccount"("companyId");

-- CreateIndex
CREATE INDEX "GmailAccount_connectionStatus_idx" ON "GmailAccount"("connectionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "GmailToken_gmailAccountId_key" ON "GmailToken"("gmailAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingRequest_reference_key" ON "SourcingRequest"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "SourcingRequest_idempotencyKey_key" ON "SourcingRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SourcingRequest_rfqId_idx" ON "SourcingRequest"("rfqId");

-- CreateIndex
CREATE INDEX "SourcingRequest_supplierId_idx" ON "SourcingRequest"("supplierId");

-- CreateIndex
CREATE INDEX "SourcingRequest_companyId_idx" ON "SourcingRequest"("companyId");

-- CreateIndex
CREATE INDEX "SourcingRequest_deliveryState_idx" ON "SourcingRequest"("deliveryState");

-- CreateIndex
CREATE INDEX "SupplierSuppression_supplierId_idx" ON "SupplierSuppression"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierSuppression_email_idx" ON "SupplierSuppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyCapitalLimit_companyId_key" ON "CompanyCapitalLimit"("companyId");
