-- Live Web Product Research V1

ALTER TABLE "Rfq" ADD COLUMN "liveResearchMetricsJson" TEXT;
ALTER TABLE "Rfq" ADD COLUMN "webResearchCoverage" REAL;

ALTER TABLE "ProductResearchCandidate" ADD COLUMN "selectionStatus" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "selectionReason" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "researchProvider" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "sourceQuality" REAL;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "priceType" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "packCalculationJson" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "deliveryJson" TEXT;
ALTER TABLE "ProductResearchCandidate" ADD COLUMN "attributeComparisonsJson" TEXT;

CREATE INDEX "ProductResearchCandidate_productUrl_idx" ON "ProductResearchCandidate"("productUrl");

CREATE TABLE "ResearchObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "rfqLineItemId" TEXT,
    "eventType" TEXT NOT NULL,
    "queryText" TEXT,
    "sourceUrl" TEXT,
    "domain" TEXT,
    "payloadJson" TEXT,
    "retrievedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResearchObservation_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ResearchObservation_rfqId_idx" ON "ResearchObservation"("rfqId");
CREATE INDEX "ResearchObservation_rfqLineItemId_idx" ON "ResearchObservation"("rfqLineItemId");
CREATE INDEX "ResearchObservation_eventType_idx" ON "ResearchObservation"("eventType");
CREATE INDEX "ResearchObservation_sourceUrl_idx" ON "ResearchObservation"("sourceUrl");
CREATE UNIQUE INDEX "ResearchObservation_rfqId_rfqLineItemId_sourceUrl_eventType_key" ON "ResearchObservation"("rfqId", "rfqLineItemId", "sourceUrl", "eventType");
