-- CreateTable
CREATE TABLE "SupplierContactChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "channelType" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "url" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "purpose" TEXT,
    "confidence" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" DATETIME,
    "evidenceNotes" TEXT,
    "isPrimaryQuoteChannel" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierContactChannel_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SupplierContactChannel_supplierId_idx" ON "SupplierContactChannel"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierContactChannel_email_idx" ON "SupplierContactChannel"("email");

-- CreateIndex
CREATE INDEX "SupplierContactChannel_channelType_idx" ON "SupplierContactChannel"("channelType");
