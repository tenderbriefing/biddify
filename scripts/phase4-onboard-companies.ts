/**
 * Onboard REAL companies from Founder compliance vault evidence.
 * Copies documents into private storage — does not invent fields.
 */
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "../src/lib/db";
import { calculateCompanyReadiness } from "../src/domain/companyReadiness";
import { resolveApprovedMailbox } from "../src/domain/companyMailboxRegistry";
import { writeAuditEvent } from "../src/lib/audit";

const VAULT = "/Users/billionaire/Desktop/Company Compliance ";
const STORAGE = path.join(process.cwd(), "storage", "companies");

type DocSpec = {
  documentType: string;
  fileName: string;
  title: string;
  issueDate?: Date;
  expiryDate?: Date;
};

type CompanySpec = {
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  csdMaaaNumber: string;
  taxNumber: string;
  vatRegistered: boolean;
  vatStatusKnown: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  physicalAddress: string;
  postalAddress: string;
  province: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankBranchCode?: string;
  bankAccountName?: string;
  commodityNotes: string;
  commodityCategories: string;
  geographicCoverage: string;
  relatedCompanyGroupId: string;
  relatedCompanyNotes: string;
  evidenceSource: string;
  folder: string;
  docs: DocSpec[];
};

const COMPANIES: CompanySpec[] = [
  {
    legalName: "ORISON CHEMICALS",
    tradingName: "Orison Chemicals",
    registrationNumber: "2014/277853/07",
    csdMaaaNumber: "MAAA1555276",
    taxNumber: "9287154190",
    vatRegistered: false,
    vatStatusKnown: true,
    contactName: "Thapelo Makhubela",
    contactEmail: "orisonchemcsd@gmail.com",
    contactPhone: "0720708467",
    physicalAddress: "201 BLOCK TT, SOSHANGUVE, Pretoria, Gauteng, 0152",
    postalAddress: "201 BLOCK TT, SOSHANGUVE, Pretoria, Gauteng, 0152",
    province: "Gauteng",
    bankName: "BANK ZERO",
    bankAccountNumber: "80204486934",
    bankBranchCode: "888000",
    bankAccountName: "ORISON CHEMICALS",
    commodityNotes:
      "CSD industry currently listed food/beverage services; company name Chemicals — Founder should confirm commodity categories for consumables RFQs.",
    commodityCategories: "Chemicals, cleaning, general supply-and-deliver",
    geographicCoverage: "Gauteng / multi-province CSD addresses",
    relatedCompanyGroupId: "orison-makhubela-group",
    relatedCompanyNotes:
      "Director/ownership links to other Orison entities — do not auto-bid multiple related companies on same RFQ.",
    evidenceSource:
      "Company Compliance /Orison Chemicals — CSD Report, COR14.3, BEE 2025, Account Confirmation, Tax letter",
    folder: "Orison Chemicals",
    docs: [
      {
        documentType: "CSD",
        fileName: "CSD Report.pdf",
        title: "CSD Registration Report",
        issueDate: new Date("2025-01-20"),
      },
      {
        documentType: "CIPC",
        fileName: "COR14.3.pdf",
        title: "CIPC COR14.3 Registration Certificate",
      },
      {
        documentType: "BBBEE",
        fileName: "BEE 2025.pdf",
        title: "B-BBEE Affidavit/Certificate 2025",
      },
      {
        documentType: "BANK",
        fileName: "Account Confirmation Letter.pdf",
        title: "Bank Account Confirmation",
      },
      {
        documentType: "TAX",
        fileName: "GetLetter.aspx-8.pdf",
        title: "Tax compliance letter",
      },
    ],
  },
  {
    legalName: "ORISON SERVICES",
    tradingName: "Orison Services",
    registrationNumber: "2020/002530/07",
    csdMaaaNumber: "MAAA1555070",
    taxNumber: "9174939240",
    vatRegistered: false,
    vatStatusKnown: true,
    contactName: "Khensani Makhubela",
    contactEmail: "orisoncsd@gmail.com",
    contactPhone: "0720708467",
    physicalAddress:
      "221 HELEN JOSEPH, 015 TUDOR CHAMBERS, Pretoria, Gauteng, 0001",
    postalAddress:
      "221 HELEN JOSEPH, 015 TUDOR CHAMBERS, Pretoria, Gauteng, 0001",
    province: "Gauteng",
    commodityNotes:
      "CSD industry currently arts/entertainment — commodity fit for lab consumables is weak unless Founder confirms expanded categories.",
    commodityCategories: "General services, supply-and-deliver (confirm)",
    geographicCoverage: "Multi-province CSD addresses",
    relatedCompanyGroupId: "orison-makhubela-group",
    relatedCompanyNotes:
      "Related to Orison Chemicals via shared director ownership — competition risk flag.",
    evidenceSource:
      "Company Compliance /Orison Services — CSD, COR14.3, Tax Pin 2027, Account Confirmation",
    folder: "Orison Services",
    docs: [
      {
        documentType: "CSD",
        fileName: "Orison Services CSD.pdf",
        title: "CSD Registration Report",
        issueDate: new Date("2025-01-15"),
      },
      {
        documentType: "CIPC",
        fileName: "COR14.3.pdf",
        title: "CIPC COR14.3 Registration Certificate",
        issueDate: new Date("2026-09-14"),
      },
      {
        documentType: "TAX",
        fileName: "Tax Pin 2027.pdf",
        title: "SARS Tax Compliance Status PIN",
        issueDate: new Date("2026-09-10"),
        expiryDate: new Date("2027-09-10"),
      },
      {
        documentType: "BANK",
        fileName: "Account Confirmation Letter.pdf",
        title: "Bank Account Confirmation",
      },
    ],
  },
];

async function copyDoc(
  companyId: string,
  folder: string,
  doc: DocSpec,
): Promise<{ localPath: string; hash: string; byteSize: number } | null> {
  const src = path.join(VAULT, folder, doc.fileName);
  try {
    const buf = await fs.readFile(src);
    const hash = createHash("sha256").update(buf).digest("hex");
    const destDir = path.join(STORAGE, companyId);
    await fs.mkdir(destDir, { recursive: true });
    const destName = `${doc.documentType}_${hash.slice(0, 12)}_${doc.fileName.replace(/[^\w.\-]+/g, "_")}`;
    const dest = path.join(destDir, destName);
    await fs.writeFile(dest, buf);
    return {
      localPath: path.relative(process.cwd(), dest),
      hash,
      byteSize: buf.length,
    };
  } catch {
    console.warn("Missing document (skipped):", src);
    return null;
  }
}

async function main() {
  await fs.mkdir(STORAGE, { recursive: true });

  // Ensure DEMO companies cannot be used operationally
  await prisma.company.updateMany({
    where: { isDemo: true },
    data: {
      dataMode: "TEST",
      outboundSourcingEnabled: false,
      notes: "TEST/DEMO fixture — blocked from operational outbound and real RFQ bidding",
    },
  });
  await prisma.supplier.updateMany({
    where: { isDemo: true },
    data: { dataMode: "TEST", emailVerified: false },
  });
  await prisma.rfq.updateMany({
    where: { isDemo: true },
    data: { dataMode: "TEST" },
  });

  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      outboundMode: "DISABLED",
      globalOutboundPaused: true,
      notes: "Phase 4 default — outbound paused until certification",
    },
    update: {},
  });

  for (const spec of COMPANIES) {
    const mailbox = resolveApprovedMailbox({
      legalName: spec.legalName,
      tradingName: spec.tradingName,
      registrationNumber: spec.registrationNumber,
    });
    const approvedSourcingMailbox = mailbox.ok
      ? mailbox.approvedGmail
      : null;

    let company = await prisma.company.findFirst({
      where: { registrationNumber: spec.registrationNumber },
    });
    if (!company) {
      company = await prisma.company.create({
        data: {
          legalName: spec.legalName,
          tradingName: spec.tradingName,
          registrationNumber: spec.registrationNumber,
          csdNumber: spec.csdMaaaNumber,
          csdMaaaNumber: spec.csdMaaaNumber,
          taxNumber: spec.taxNumber,
          vatRegistered: spec.vatRegistered,
          vatStatusKnown: spec.vatStatusKnown,
          contactName: spec.contactName,
          contactEmail: spec.contactEmail,
          contactPhone: spec.contactPhone,
          physicalAddress: spec.physicalAddress,
          postalAddress: spec.postalAddress,
          province: spec.province,
          bankName: spec.bankName,
          bankAccountNumber: spec.bankAccountNumber,
          bankBranchCode: spec.bankBranchCode,
          bankAccountName: spec.bankAccountName,
          commodityNotes: spec.commodityNotes,
          commodityCategories: spec.commodityCategories,
          geographicCoverage: spec.geographicCoverage,
          relatedCompanyGroupId: spec.relatedCompanyGroupId,
          relatedCompanyNotes: spec.relatedCompanyNotes,
          evidenceSource: spec.evidenceSource,
          approvedSourcingMailbox,
          dataMode: "OPERATIONAL",
          isDemo: false,
          isActive: true,
          outboundSourcingEnabled: false,
        },
      });
    } else {
      company = await prisma.company.update({
        where: { id: company.id },
        data: {
          tradingName: spec.tradingName,
          csdMaaaNumber: spec.csdMaaaNumber,
          csdNumber: spec.csdMaaaNumber,
          taxNumber: spec.taxNumber,
          vatRegistered: spec.vatRegistered,
          vatStatusKnown: spec.vatStatusKnown,
          contactName: spec.contactName,
          contactEmail: spec.contactEmail,
          contactPhone: spec.contactPhone,
          physicalAddress: spec.physicalAddress,
          postalAddress: spec.postalAddress,
          province: spec.province,
          bankName: spec.bankName,
          bankAccountNumber: spec.bankAccountNumber,
          bankBranchCode: spec.bankBranchCode,
          bankAccountName: spec.bankAccountName,
          commodityNotes: spec.commodityNotes,
          commodityCategories: spec.commodityCategories,
          geographicCoverage: spec.geographicCoverage,
          relatedCompanyGroupId: spec.relatedCompanyGroupId,
          relatedCompanyNotes: spec.relatedCompanyNotes,
          evidenceSource: spec.evidenceSource,
          approvedSourcingMailbox,
          dataMode: "OPERATIONAL",
          isDemo: false,
        },
      });
    }

    const storedTypes = new Set<string>();
    for (const doc of spec.docs) {
      const copied = await copyDoc(company.id, spec.folder, doc);
      if (!copied) continue;
      storedTypes.add(doc.documentType);
      const existing = await prisma.companyDocument.findFirst({
        where: { companyId: company.id, contentHash: copied.hash },
      });
      if (existing) continue;
      await prisma.companyDocument.create({
        data: {
          companyId: company.id,
          documentType: doc.documentType,
          title: doc.title,
          issueDate: doc.issueDate,
          expiryDate: doc.expiryDate,
          verificationState: "AVAILABLE",
          localPath: copied.localPath,
          contentHash: copied.hash,
          sourcePath: path.join(VAULT, spec.folder, doc.fileName),
          isDemo: false,
          notes: `Onboarded from evidence vault; hash ${copied.hash.slice(0, 16)}`,
        },
      });
    }

    const readiness = calculateCompanyReadiness({
      hasCipc: storedTypes.has("CIPC"),
      hasCsd: storedTypes.has("CSD"),
      taxCompliant: storedTypes.has("TAX") ? true : "UNKNOWN",
      hasBee: storedTypes.has("BBBEE")
        ? true
        : spec.legalName === "ORISON SERVICES"
          ? "NOT_APPLICABLE"
          : false,
      hasBankConfirmation: storedTypes.has("BANK"),
      vatStatusKnown: spec.vatStatusKnown,
    });

    await prisma.company.update({
      where: { id: company.id },
      data: {
        readinessOverall: readiness.overall,
        readinessDetails: JSON.stringify(readiness),
      },
    });

    await writeAuditEvent({
      action: "COMPANY_ONBOARDED",
      entityType: "Company",
      entityId: company.id,
      metadata: {
        legalName: company.legalName,
        readiness: readiness.overall,
        blockers: readiness.blockers,
      },
    });

    console.log(
      JSON.stringify(
        {
          company: company.legalName,
          id: company.id,
          readiness: readiness.overall,
          blockers: readiness.blockers,
          docs: [...storedTypes],
        },
        null,
        2,
      ),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
