-- AlterTable
ALTER TABLE "Company" ADD COLUMN "authorisedSourcingSignatoryName" TEXT;
ALTER TABLE "Company" ADD COLUMN "authorisedSourcingSignatoryEmail" TEXT;
ALTER TABLE "Company" ADD COLUMN "authorisedSourcingSignatoryConfirmedAt" DATETIME;
ALTER TABLE "Company" ADD COLUMN "authorisedSourcingSignatoryConfirmedBy" TEXT;

-- AlterTable
ALTER TABLE "SourcingRequest" ADD COLUMN "externalReference" TEXT;
