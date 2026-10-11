-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "legalName" TEXT NOT NULL,
    "tradingName" TEXT,
    "registrationNumber" TEXT,
    "csdNumber" TEXT,
    "taxNumber" TEXT,
    "vatRegistered" BOOLEAN NOT NULL DEFAULT false,
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
    "geographicCoverage" TEXT,
    "restrictions" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issueDate" DATETIME,
    "expiryDate" DATETIME,
    "version" TEXT,
    "verificationState" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "storageKey" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "email" TEXT,
    "telephone" TEXT,
    "categories" TEXT,
    "brands" TEXT,
    "geographicCoverage" TEXT,
    "paymentTerms" TEXT,
    "deliveryCapability" TEXT,
    "reliabilityNotes" TEXT,
    "responseSpeedNotes" TEXT,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SupplierContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "telephone" TEXT,
    "role" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierContact_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Rfq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "internalId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT,
    "tenderNumber" TEXT,
    "buyer" TEXT NOT NULL,
    "department" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "province" TEXT,
    "municipality" TEXT,
    "deliveryAddress" TEXT,
    "publicationDate" DATETIME,
    "briefingDate" DATETIME,
    "briefingCompulsory" BOOLEAN NOT NULL DEFAULT false,
    "questionsDeadline" DATETIME,
    "closingAt" DATETIME NOT NULL,
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
    "noBidReason" TEXT,
    "selectedCompanyId" TEXT,
    "duplicateOfId" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rfq_selectedCompanyId_fkey" FOREIGN KEY ("selectedCompanyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rfq_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "Rfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RfqLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "product" TEXT,
    "description" TEXT NOT NULL,
    "specification" TEXT,
    "brandRequirement" TEXT,
    "equivalentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "quantity" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "deliveryDestination" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqLineItem_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RfqRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sourceHint" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqRequirement_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RfqDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "documentType" TEXT,
    "storageKey" TEXT,
    "pageCount" INTEGER,
    "extractedAt" DATETIME,
    "isSource" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqDocument_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteReference" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "deliveryCost" DECIMAL NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER,
    "paymentTerms" TEXT,
    "vatIncluded" BOOLEAN,
    "notes" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierQuote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierQuoteLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierQuoteId" TEXT NOT NULL,
    "rfqLineItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "lineTotal" DECIMAL NOT NULL,
    "brandOffered" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierQuoteLineItem_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "SupplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuoteLineItem_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RfqLineItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Primary',
    "markupPercent" DECIMAL NOT NULL DEFAULT 20,
    "supplierCostTotal" DECIMAL NOT NULL DEFAULT 0,
    "deliveryCost" DECIMAL NOT NULL DEFAULT 0,
    "logisticsCost" DECIMAL NOT NULL DEFAULT 0,
    "packagingCost" DECIMAL NOT NULL DEFAULT 0,
    "insuranceCost" DECIMAL NOT NULL DEFAULT 0,
    "financingCost" DECIMAL NOT NULL DEFAULT 0,
    "contingencyCost" DECIMAL NOT NULL DEFAULT 0,
    "otherDirectCosts" DECIMAL NOT NULL DEFAULT 0,
    "landedCost" DECIMAL NOT NULL DEFAULT 0,
    "sellingPriceExVat" DECIMAL NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL NOT NULL DEFAULT 0,
    "totalQuotation" DECIMAL NOT NULL DEFAULT 0,
    "grossProfit" DECIMAL NOT NULL DEFAULT 0,
    "grossMarginPercent" DECIMAL NOT NULL DEFAULT 0,
    "workingCapitalRequired" DECIMAL NOT NULL DEFAULT 0,
    "profitabilityGate" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "vatRegisteredSnapshot" BOOLEAN,
    "notes" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingScenario_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pricingScenarioId" TEXT NOT NULL,
    "rfqLineItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL NOT NULL,
    "lineCost" DECIMAL NOT NULL,
    "unitSell" DECIMAL NOT NULL,
    "lineSell" DECIMAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingLineItem_pricingScenarioId_fkey" FOREIGN KEY ("pricingScenarioId") REFERENCES "PricingScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PricingLineItem_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RfqLineItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ComplianceRequirement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "state" TEXT NOT NULL DEFAULT 'MISSING',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ComplianceRequirement_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PRICING',
    "approvedPrice" DECIMAL,
    "submissionMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "founderApprovedAt" DATETIME,
    "submissionAuthorisedAt" DATETIME,
    "submittedAt" DATETIME,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Bid_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Bid_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bidId" TEXT,
    "pricingScenarioId" TEXT,
    "approverId" TEXT NOT NULL,
    "approvedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedPrice" DECIMAL NOT NULL,
    "approvedCompanyId" TEXT,
    "approvedSupplierConfig" TEXT,
    "approvedSubmissionMethod" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "comments" TEXT,
    "isValid" BOOLEAN NOT NULL DEFAULT true,
    "invalidatedAt" DATETIME,
    "invalidationReason" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Approval_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Approval_pricingScenarioId_fkey" FOREIGN KEY ("pricingScenarioId") REFERENCES "PricingScenario" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Approval_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RfqStatusEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "userId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RfqStatusEvent_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RfqStatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "userId" TEXT,
    "previousState" TEXT,
    "newState" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "companyId" TEXT,
    "rfqId" TEXT,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deliveryState" TEXT NOT NULL DEFAULT 'MOCK_HELD',
    "workflow" TEXT,
    "isMock" BOOLEAN NOT NULL DEFAULT true,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_idx" ON "CompanyDocument"("companyId");

-- CreateIndex
CREATE INDEX "SupplierContact_supplierId_idx" ON "SupplierContact"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "Rfq_internalId_key" ON "Rfq"("internalId");

-- CreateIndex
CREATE INDEX "Rfq_status_idx" ON "Rfq"("status");

-- CreateIndex
CREATE INDEX "Rfq_closingAt_idx" ON "Rfq"("closingAt");

-- CreateIndex
CREATE INDEX "Rfq_selectedCompanyId_idx" ON "Rfq"("selectedCompanyId");

-- CreateIndex
CREATE INDEX "RfqLineItem_rfqId_idx" ON "RfqLineItem"("rfqId");

-- CreateIndex
CREATE INDEX "RfqRequirement_rfqId_idx" ON "RfqRequirement"("rfqId");

-- CreateIndex
CREATE INDEX "RfqDocument_rfqId_idx" ON "RfqDocument"("rfqId");

-- CreateIndex
CREATE INDEX "SupplierQuote_rfqId_idx" ON "SupplierQuote"("rfqId");

-- CreateIndex
CREATE INDEX "SupplierQuote_supplierId_idx" ON "SupplierQuote"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierQuoteLineItem_supplierQuoteId_idx" ON "SupplierQuoteLineItem"("supplierQuoteId");

-- CreateIndex
CREATE INDEX "PricingScenario_rfqId_idx" ON "PricingScenario"("rfqId");

-- CreateIndex
CREATE INDEX "PricingLineItem_pricingScenarioId_idx" ON "PricingLineItem"("pricingScenarioId");

-- CreateIndex
CREATE INDEX "ComplianceRequirement_rfqId_idx" ON "ComplianceRequirement"("rfqId");

-- CreateIndex
CREATE INDEX "Bid_rfqId_idx" ON "Bid"("rfqId");

-- CreateIndex
CREATE INDEX "Bid_companyId_idx" ON "Bid"("companyId");

-- CreateIndex
CREATE INDEX "Approval_bidId_idx" ON "Approval"("bidId");

-- CreateIndex
CREATE INDEX "Approval_approverId_idx" ON "Approval"("approverId");

-- CreateIndex
CREATE INDEX "RfqStatusEvent_rfqId_idx" ON "RfqStatusEvent"("rfqId");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "EmailMessage_rfqId_idx" ON "EmailMessage"("rfqId");
