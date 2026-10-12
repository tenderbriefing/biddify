-- AlterTable
ALTER TABLE "Company" ADD COLUMN "approvedSourcingMailbox" TEXT;

-- AlterTable
ALTER TABLE "SourcingRequest" ADD COLUMN "approvedSenderGmail" TEXT;
