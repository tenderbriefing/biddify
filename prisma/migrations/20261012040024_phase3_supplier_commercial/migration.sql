-- CreateTable
CREATE TABLE "SupplierEnquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deliveryState" TEXT NOT NULL DEFAULT 'DRAFT_NOT_SENT',
    "productsSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierEnquiry_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierEnquiry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PricingScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Primary',
    "markupPercent" DECIMAL NOT NULL DEFAULT 20,
    "supplierCostTotal" DECIMAL NOT NULL DEFAULT 0,
    "supplierInputVatCost" DECIMAL NOT NULL DEFAULT 0,
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
    "upfrontCashRequired" DECIMAL NOT NULL DEFAULT 0,
    "expectedRecoveryDays" INTEGER,
    "supplierPaymentTerms" TEXT,
    "buyerPaymentTerms" TEXT,
    "financingAssumption" TEXT,
    "evidenceQuality" TEXT,
    "profitabilityGate" TEXT NOT NULL DEFAULT 'UNREVIEWED',
    "profitabilityReasons" TEXT,
    "vatRegisteredSnapshot" BOOLEAN,
    "notes" TEXT,
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingScenario_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PricingScenario" ("contingencyCost", "createdAt", "deliveryCost", "financingCost", "grossMarginPercent", "grossProfit", "id", "insuranceCost", "isDemo", "isSelected", "landedCost", "logisticsCost", "markupPercent", "name", "notes", "otherDirectCosts", "packagingCost", "profitabilityGate", "rfqId", "sellingPriceExVat", "supplierCostTotal", "totalQuotation", "updatedAt", "vatAmount", "vatRegisteredSnapshot", "workingCapitalRequired") SELECT "contingencyCost", "createdAt", "deliveryCost", "financingCost", "grossMarginPercent", "grossProfit", "id", "insuranceCost", "isDemo", "isSelected", "landedCost", "logisticsCost", "markupPercent", "name", "notes", "otherDirectCosts", "packagingCost", "profitabilityGate", "rfqId", "sellingPriceExVat", "supplierCostTotal", "totalQuotation", "updatedAt", "vatAmount", "vatRegisteredSnapshot", "workingCapitalRequired" FROM "PricingScenario";
DROP TABLE "PricingScenario";
ALTER TABLE "new_PricingScenario" RENAME TO "PricingScenario";
CREATE INDEX "PricingScenario_rfqId_idx" ON "PricingScenario"("rfqId");
CREATE TABLE "new_RfqDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "documentType" TEXT,
    "storageKey" TEXT,
    "localPath" TEXT,
    "sourceUrl" TEXT,
    "format" TEXT,
    "pageCount" INTEGER,
    "byteSize" INTEGER,
    "contentHash" TEXT,
    "retrievedAt" DATETIME,
    "extractedAt" DATETIME,
    "processingState" TEXT NOT NULL DEFAULT 'PENDING',
    "extractedText" TEXT,
    "isSource" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqDocument_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_RfqDocument" ("createdAt", "documentType", "extractedAt", "fileName", "format", "id", "isDemo", "isSource", "notes", "pageCount", "rfqId", "sourceUrl", "storageKey", "updatedAt") SELECT "createdAt", "documentType", "extractedAt", "fileName", "format", "id", "isDemo", "isSource", "notes", "pageCount", "rfqId", "sourceUrl", "storageKey", "updatedAt" FROM "RfqDocument";
DROP TABLE "RfqDocument";
ALTER TABLE "new_RfqDocument" RENAME TO "RfqDocument";
CREATE INDEX "RfqDocument_rfqId_idx" ON "RfqDocument"("rfqId");
CREATE INDEX "RfqDocument_contentHash_idx" ON "RfqDocument"("contentHash");
CREATE TABLE "new_RfqLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "product" TEXT,
    "description" TEXT NOT NULL,
    "specification" TEXT,
    "brandRequirement" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "sku" TEXT,
    "equivalentAllowed" BOOLEAN NOT NULL DEFAULT true,
    "mandatoryCharacteristics" TEXT,
    "quantity" DECIMAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "deliveryDestination" TEXT,
    "notes" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "extractionMethod" TEXT,
    "extractionConfidence" REAL,
    "sourceDocumentId" TEXT,
    "sourcePage" TEXT,
    "sourceSection" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RfqLineItem_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RfqLineItem_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "RfqDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RfqLineItem" ("brandRequirement", "createdAt", "deliveryDestination", "description", "equivalentAllowed", "id", "lineNumber", "notes", "product", "quantity", "rfqId", "specification", "unit", "updatedAt") SELECT "brandRequirement", "createdAt", "deliveryDestination", "description", "equivalentAllowed", "id", "lineNumber", "notes", "product", "quantity", "rfqId", "specification", "unit", "updatedAt" FROM "RfqLineItem";
DROP TABLE "RfqLineItem";
ALTER TABLE "new_RfqLineItem" RENAME TO "RfqLineItem";
CREATE INDEX "RfqLineItem_rfqId_idx" ON "RfqLineItem"("rfqId");
CREATE TABLE "new_Supplier" (
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
    "supplierType" TEXT,
    "discoverySource" TEXT,
    "verificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "evidenceUrl" TEXT,
    "location" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Supplier" ("brands", "categories", "createdAt", "deliveryCapability", "email", "geographicCoverage", "id", "isActive", "isDemo", "name", "notes", "paymentTerms", "reliabilityNotes", "responseSpeedNotes", "telephone", "updatedAt", "website") SELECT "brands", "categories", "createdAt", "deliveryCapability", "email", "geographicCoverage", "id", "isActive", "isDemo", "name", "notes", "paymentTerms", "reliabilityNotes", "responseSpeedNotes", "telephone", "updatedAt", "website" FROM "Supplier";
DROP TABLE "Supplier";
ALTER TABLE "new_Supplier" RENAME TO "Supplier";
CREATE TABLE "new_SupplierQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "quoteReference" TEXT,
    "quoteDate" DATETIME,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" DATETIME,
    "currency" TEXT NOT NULL DEFAULT 'ZAR',
    "deliveryCost" DECIMAL,
    "deliveryKnown" BOOLEAN NOT NULL DEFAULT false,
    "leadTimeDays" INTEGER,
    "paymentTerms" TEXT,
    "vatIncluded" BOOLEAN,
    "vatKnown" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL,
    "vatAmount" DECIMAL,
    "totalAmount" DECIMAL,
    "evidenceType" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "verificationState" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceDocumentPath" TEXT,
    "notes" TEXT,
    "isComplete" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierQuote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_SupplierQuote" ("createdAt", "currency", "deliveryCost", "id", "isComplete", "isDemo", "leadTimeDays", "notes", "paymentTerms", "quoteReference", "receivedAt", "rfqId", "supplierId", "updatedAt", "validUntil", "vatIncluded") SELECT "createdAt", "currency", "deliveryCost", "id", "isComplete", "isDemo", "leadTimeDays", "notes", "paymentTerms", "quoteReference", "receivedAt", "rfqId", "supplierId", "updatedAt", "validUntil", "vatIncluded" FROM "SupplierQuote";
DROP TABLE "SupplierQuote";
ALTER TABLE "new_SupplierQuote" RENAME TO "SupplierQuote";
CREATE INDEX "SupplierQuote_rfqId_idx" ON "SupplierQuote"("rfqId");
CREATE INDEX "SupplierQuote_supplierId_idx" ON "SupplierQuote"("supplierId");
CREATE INDEX "SupplierQuote_evidenceType_idx" ON "SupplierQuote"("evidenceType");
CREATE TABLE "new_SupplierQuoteLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierQuoteId" TEXT NOT NULL,
    "rfqLineItemId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL NOT NULL,
    "unitCost" DECIMAL,
    "priceKnown" BOOLEAN NOT NULL DEFAULT false,
    "lineTotal" DECIMAL,
    "brandOffered" TEXT,
    "modelOffered" TEXT,
    "sku" TEXT,
    "matchState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "mappingConfidence" REAL,
    "mappingNotes" TEXT,
    "availability" TEXT,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierQuoteLineItem_supplierQuoteId_fkey" FOREIGN KEY ("supplierQuoteId") REFERENCES "SupplierQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierQuoteLineItem_rfqLineItemId_fkey" FOREIGN KEY ("rfqLineItemId") REFERENCES "RfqLineItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SupplierQuoteLineItem" ("brandOffered", "createdAt", "description", "id", "lineTotal", "notes", "quantity", "rfqLineItemId", "supplierQuoteId", "unitCost", "updatedAt") SELECT "brandOffered", "createdAt", "description", "id", "lineTotal", "notes", "quantity", "rfqLineItemId", "supplierQuoteId", "unitCost", "updatedAt" FROM "SupplierQuoteLineItem";
DROP TABLE "SupplierQuoteLineItem";
ALTER TABLE "new_SupplierQuoteLineItem" RENAME TO "SupplierQuoteLineItem";
CREATE INDEX "SupplierQuoteLineItem_supplierQuoteId_idx" ON "SupplierQuoteLineItem"("supplierQuoteId");
CREATE INDEX "SupplierQuoteLineItem_rfqLineItemId_idx" ON "SupplierQuoteLineItem"("rfqLineItemId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "SupplierEnquiry_rfqId_idx" ON "SupplierEnquiry"("rfqId");

-- CreateIndex
CREATE INDEX "SupplierEnquiry_supplierId_idx" ON "SupplierEnquiry"("supplierId");
