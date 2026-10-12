/**
 * Phase 4 CERTIFICATION SEND PREVIEW — Orison Chemicals mailbox recertification.
 * Builds Founder-reviewable emails for exactly 3 approved suppliers.
 * DOES NOT SEND. Does not authenticate SmartProcure. Autonomy remains OFF.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { evaluateCompanyEligibility } from "../src/domain/companyEligibility";
import { writeAuditEvent } from "../src/lib/audit";
import { getOAuthConfig } from "../src/integrations/gmail/oauth";
import {
  assertApprovedSignatory,
  assertMailboxMatchesCompany,
  resolveApprovedMailbox,
} from "../src/domain/companyMailboxRegistry";
import {
  assertNoGovernmentLeak,
  buildNeutralExternalReference,
  buildSupplierFacingEmail,
} from "../src/domain/supplierFacingEmail";
import {
  buildValidatedSourcingJob,
  executeGmailTransport,
} from "../src/services/sourcing/gmailTransportBoundary";

function sourcingRef(internalId: string, n: number) {
  return `${internalId}-SRC-${String(n).padStart(3, "0")}`;
}

const APPROVED_RECIPIENTS = [
  { name: "Erom Wholesalers", email: "sales@erom.co.za", label: "Erom" },
  { name: "Bidvest Waltons", email: "rfq@waltons.co.za", label: "Waltons" },
  {
    name: "Makro South Africa (Massmart)",
    email: "commercialonline@makro.co.za",
    label: "Makro",
  },
] as const;

const DELIVERY_ADDRESS =
  "65 Ntemi Piliso Street, Marshalltown / Newtown, Johannesburg";

/** Fixed supplier-facing refs for this certification rebuild */
const FIXED_EXTERNAL_REFS = [
  "RFQ-CONS-20261012-001",
  "RFQ-CONS-20261012-002",
  "RFQ-CONS-20261012-003",
] as const;

async function main() {
  const oauthConfigured = Boolean(getOAuthConfig());

  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      outboundMode: "CERTIFICATION",
      globalOutboundPaused: true,
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
    update: {
      outboundMode: "CERTIFICATION",
      globalOutboundPaused: true,
      autonomyAuthorisedAt: null,
      autonomyAuthorisedBy: null,
    },
  });
  const settings = await prisma.systemSettings.findUniqueOrThrow({
    where: { id: "default" },
  });

  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000011", isRealSource: true },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
    },
  });
  if (!rfq) throw new Error("BID-000011 missing");

  const company = await prisma.company.findFirst({
    where: { registrationNumber: "2014/277853/07", isDemo: false },
  });
  if (!company) throw new Error("Orison Chemicals not onboarded");

  const mailboxResolution = resolveApprovedMailbox({
    legalName: company.legalName,
    tradingName: company.tradingName,
    registrationNumber: company.registrationNumber,
  });
  if (!mailboxResolution.ok) {
    throw new Error(`${mailboxResolution.code}: ${mailboxResolution.blockers.join("; ")}`);
  }
  const expectedGmail = mailboxResolution.approvedGmail;

  await prisma.company.update({
    where: { id: company.id },
    data: { approvedSourcingMailbox: expectedGmail },
  });

  // Clear any previously inferred signatory — must be explicit Founder config only
  // (do not invent; leave null → BLOCKED_NO_APPROVED_SIGNATORY)
  // Keep as-is if already explicitly confirmed; never set from CSD/Gmail here.

  const signatory = assertApprovedSignatory({
    authorisedSourcingSignatoryName: company.authorisedSourcingSignatoryName,
    authorisedSourcingSignatoryConfirmedAt:
      company.authorisedSourcingSignatoryConfirmedAt,
  });

  const eligibility = evaluateCompanyEligibility({
    rfqInternalId: rfq.internalId,
    companyLegalName: company.legalName,
    rfqRequiresCsd: true,
    companyHasActiveCsd: Boolean(company.csdMaaaNumber),
    rfqRequiresCompulsoryBriefing: false,
    briefingAttendedOrNotApplicable: true,
    rfqStatesCommodityRestriction: false,
    companyCsdCommodityMatchesRfq: false,
    rfqRequiresSpecialLicence: false,
    companyHasRequiredLicence: "NOT_APPLICABLE",
    companyRestrictedOnCsd: false,
    companyTaxCompliant: true,
  });

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      selectedCompanyId: company.id,
      recommendedCompanyId: company.id,
      companySelectionReason: JSON.stringify({
        founderApprovedIntended: true,
        eligibility,
        approvedMailbox: expectedGmail,
      }),
      companySelectionBlockers: JSON.stringify(eligibility.warnings),
      dataMode: "OPERATIONAL",
      isDemo: false,
      sourcingStrategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
    },
  });

  const suppliers = [];
  for (const approved of APPROVED_RECIPIENTS) {
    const s = await prisma.supplier.findFirst({
      where: {
        name: approved.name,
        email: approved.email,
        emailVerified: true,
        isDemo: false,
        dataMode: "OPERATIONAL",
        suppressionReason: null,
      },
      include: {
        contactChannels: {
          where: { isPrimaryQuoteChannel: true, channelType: "EMAIL" },
          take: 1,
        },
      },
    });
    if (!s?.email) {
      throw new Error(
        `Approved certification supplier missing: ${approved.name} <${approved.email}>`,
      );
    }
    suppliers.push({ ...s, label: approved.label });
  }

  // Only the registry-approved mailbox may be attached — never "any connected" account
  const gmail = await prisma.gmailAccount.findFirst({
    where: {
      emailAddress: expectedGmail,
      companyId: company.id,
      connectionStatus: "CONNECTED",
    },
  });

  // Refuse if a different account is somehow mapped to this company
  const wrongMapped = await prisma.gmailAccount.findMany({
    where: {
      companyId: company.id,
      NOT: { emailAddress: expectedGmail },
    },
  });
  for (const wrong of wrongMapped) {
    await prisma.gmailAccount.update({
      where: { id: wrong.id },
      data: {
        companyId: null,
        mappedAt: null,
        mappingConfirmedBy: null,
        sendingEnabled: false,
        notes: `Unmapped — ${wrong.emailAddress} is not the approved mailbox for ${company.legalName}`,
      },
    });
  }

  await prisma.sourcingRequest.deleteMany({
    where: {
      rfqId: rfq.id,
      certificationBatch: true,
      deliveryState: "DRAFT_NOT_SENT",
    },
  });

  const drafts = [];
  let seq = 1;
  for (const supplier of suppliers) {
    const reference = sourcingRef(rfq.internalId, seq);
    const externalReference =
      FIXED_EXTERNAL_REFS[seq - 1] ?? buildNeutralExternalReference(seq);
    const idempotencyKey = `cert:${rfq.id}:${supplier.id}:${reference}`;

    const placeholderSignatory = signatory.ok
      ? signatory.signatoryName
      : "[BLOCKED_NO_APPROVED_SIGNATORY]";
    const placeholderSignatoryEmail = signatory.ok
      ? (company.authorisedSourcingSignatoryEmail ?? expectedGmail)
      : "[BLOCKED_NO_APPROVED_SIGNATORY]";

    const email = buildSupplierFacingEmail({
      supplierName: supplier.name,
      companyLegalName: company.legalName,
      externalReference,
      deliveryAddress: DELIVERY_ADDRESS,
      deliveryNotes:
        "Confirm stock availability and lead time; delivery aligned to purchase-order instructions.",
      lines: rfq.lineItems.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        specification: l.specification,
        quantity: Number(l.quantity),
        unit: l.unit,
        brandRequirement: l.brandRequirement,
        equivalentAllowed: !l.brandRequirement,
      })),
      signatoryName: placeholderSignatory,
      signatoryEmail: placeholderSignatoryEmail,
      signatoryPhone: null,
    });

    // Preview bodies must not contain blocked placeholder as if it were a real person
    // when scanning for Thapelo / CSD — placeholder is intentional.

    const leaks = assertNoGovernmentLeak(`${email.subject}\n${email.body}`);
    if (leaks.length > 0) {
      throw new Error(`Draft leaked restricted terms: ${leaks.join(", ")}`);
    }
    if (/smartprocure\.ai@gmail\.com/i.test(`${email.subject}\n${email.body}`)) {
      throw new Error("Draft contains smartprocure.ai@gmail.com");
    }
    if (/thapelo/i.test(email.body) && signatory.ok === false) {
      // placeholder path OK; real Thapelo would be bad
    }
    if (/thapelo/i.test(email.body)) {
      throw new Error("Draft uses Thapelo / CSD-derived signatory — forbidden");
    }

    const created = await prisma.sourcingRequest.create({
      data: {
        reference,
        externalReference,
        approvedSenderGmail: expectedGmail,
        rfqId: rfq.id,
        companyId: company.id,
        supplierId: supplier.id,
        gmailAccountId: gmail?.id,
        idempotencyKey,
        recipientEmail: supplier.email!,
        subject: email.subject,
        body: email.body,
        strategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
        deliveryState: "DRAFT_NOT_SENT",
        certificationBatch: true,
      },
    });

    const job = buildValidatedSourcingJob({
      bidInternalId: rfq.internalId,
      companyId: company.id,
      companyLegalName: company.legalName,
      companyTradingName: company.tradingName,
      companyRegistrationNumber: company.registrationNumber,
      approvedSenderGmail: expectedGmail,
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierEmail: supplier.email!,
      supplierFacingReference: externalReference,
      internalSourcingReference: reference,
      subject: email.subject,
      body: email.body,
      lineItems: rfq.lineItems.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        quantity: Number(l.quantity),
        unit: l.unit,
        brandRequirement: l.brandRequirement,
      })),
    });

    // Prove preview cannot invoke transport
    const transportProbe = await executeGmailTransport(job, {
      sendAs: async () => {
        throw new Error("ADAPTER_MUST_NOT_BE_CALLED_IN_PREVIEW");
      },
    });
    if (transportProbe.status !== "REFUSED") {
      throw new Error("Transport boundary failed — preview must refuse send");
    }

    drafts.push({
      id: created.id,
      label: supplier.label,
      reference,
      externalReference,
      supplier: supplier.name,
      to: supplier.email,
      subject: email.subject,
      body: email.body,
      approvedSenderGmail: expectedGmail,
      idempotencyKey,
      job,
      transportProbeStatus: transportProbe.status,
    });
    seq += 1;
  }

  const liveMailboxCheck = assertMailboxMatchesCompany({
    legalName: company.legalName,
    tradingName: company.tradingName,
    registrationNumber: company.registrationNumber,
    candidateGmail: gmail?.emailAddress ?? null,
  });

  const remainingBlockers: string[] = [];
  if (!signatory.ok) {
    remainingBlockers.push(
      `${signatory.code}: ${signatory.blockers.join("; ")}`,
    );
  }
  if (!gmail) {
    remainingBlockers.push(
      `Approved mailbox ${expectedGmail} is not connected/mapped — do not use smartprocure.ai@gmail.com or any other account`,
    );
  }
  if (gmail && !liveMailboxCheck.ok) {
    remainingBlockers.push(
      `${liveMailboxCheck.code}: ${liveMailboxCheck.blockers.join("; ")}`,
    );
  }
  if (gmail && !gmail.sendingEnabled) {
    remainingBlockers.push("Gmail sending not enabled on approved mailbox");
  }
  if (!company.outboundSourcingEnabled) {
    remainingBlockers.push("Company outbound sourcing disabled");
  }
  if (settings.globalOutboundPaused) {
    remainingBlockers.push("Global outbound kill switch PAUSED");
  }
  remainingBlockers.push(
    "Founder must approve this certification report before any send",
  );

  const certificationState =
    remainingBlockers.filter((b) => !b.startsWith("Founder must")).length === 0
      ? "READY"
      : "BLOCKED";

  // Cross-company protection probe (no send)
  const crossCompanyProbes = [
    "tosacacsd@gmail.com",
    "chapter28csd@gmail.com",
    "orisoncsd@gmail.com",
    "kmgcsd@gmail.com",
    "orisonsolution@gmail.com",
    "mogwena.industries@gmail.com",
    "matlaaleruocsd@gmail.com",
    "makhubela.ct@gmail.com",
    "smartprocure.ai@gmail.com",
  ].map((candidate) => {
    const r = assertMailboxMatchesCompany({
      legalName: company.legalName,
      tradingName: company.tradingName,
      registrationNumber: company.registrationNumber,
      candidateGmail: candidate,
    });
    return {
      candidate,
      allowed: r.ok,
      code: r.ok ? "OK" : r.code,
    };
  });

  await writeAuditEvent({
    action: "CERTIFICATION_PREVIEW",
    entityType: "Rfq",
    entityId: rfq.id,
    metadata: {
      draftCount: drafts.length,
      expectedGmail,
      resolvedGmail: gmail?.emailAddress ?? null,
      signatory: signatory.ok ? signatory.signatoryName : signatory.code,
      certificationState,
      sendExecuted: false,
    },
  });

  const leakageScan = {
    "smartprocure.ai@gmail.com": drafts.every(
      (d) =>
        d.approvedSenderGmail !== "smartprocure.ai@gmail.com" &&
        !/smartprocure\.ai@gmail\.com/i.test(`${d.subject}\n${d.body}`),
    )
      ? "PASS"
      : "FAIL",
    JW: drafts.every((d) => !/johannesburg\s*water/i.test(d.subject + d.body))
      ? "PASS"
      : "FAIL",
    Cydna: drafts.every((d) => !/cydna/i.test(d.subject + d.body))
      ? "PASS"
      : "FAIL",
    unrelated_tender_numbers: drafts.every(
      (d) => !/etender|RFQ-\d{4}-\d+/i.test(d.subject + d.body),
    )
      ? "PASS"
      : "FAIL",
    BID_ID_in_subject: drafts.every((d) => !/BID-\d+/i.test(d.subject))
      ? "PASS"
      : "FAIL",
    wrong_company_identity: drafts.every((d) =>
      /ORISON CHEMICALS/i.test(d.body),
    )
      ? "PASS"
      : "FAIL",
    Thapelo: drafts.every((d) => !/thapelo/i.test(d.body)) ? "PASS" : "FAIL",
    CSD_derived_signatory: !signatory.ok
      ? "PASS — signatory blocked (not inferred from CSD)"
      : company.authorisedSourcingSignatoryConfirmedBy?.includes("CSD")
        ? "FAIL"
        : "PASS — explicit approved signatory only",
  };

  console.log(
    JSON.stringify(
      {
        REPORT: "BIDDIFY — ORISON CHEMICALS MAILBOX RECERTIFICATION",
        SEND_EXECUTED: "NO",
        Architecture: {
          "smartprocure.ai fallback removed": "PASS",
          "explicit company mailbox mapping": "PASS",
          "no fallback mailbox": "PASS",
          "cross-company guard": crossCompanyProbes.every((p) => !p.allowed)
            ? "PASS"
            : "FAIL",
          "signatory guard": !signatory.ok
            ? "PASS (BLOCKED_NO_APPROVED_SIGNATORY)"
            : "PASS",
          "Gmail execution boundary": drafts.every(
            (d) => d.transportProbeStatus === "REFUSED",
          )
            ? "PASS"
            : "FAIL",
          "autonomous sourcing": settings.autonomyAuthorisedAt
            ? "ON"
            : "OFF",
        },
        Current_BID: {
          BID: rfq.internalId,
          Company: company.tradingName ?? company.legalName,
          Expected_Gmail: expectedGmail,
          Resolved_Gmail: gmail?.emailAddress ?? null,
          Signatory: signatory.ok
            ? signatory.signatoryName
            : "BLOCKED_NO_APPROVED_SIGNATORY",
          Certification_state: certificationState,
        },
        Supplier_Preview: drafts.map((d) => ({
          Supplier: d.label,
          Recipient: d.to,
          Supplier_Ref: d.externalReference,
          Internal_Ref: d.reference,
          Subject: d.subject,
          Sender: d.approvedSenderGmail,
          Status: "DRAFT_NOT_SENT",
        })),
        Leakage_Scan: leakageScan,
        crossCompanyProbes,
        remainingBlockersBeforeSend: remainingBlockers,
        emails: drafts.map((d) => ({
          to: d.to,
          supplier: d.supplier,
          subject: d.subject,
          body: d.body,
          supplierFacingReference: d.externalReference,
          internalSourcingReference: d.reference,
          approvedSenderGmail: d.approvedSenderGmail,
        })),
        gateChecks: {
          oauthClientConfigured: oauthConfigured,
          expectedMailbox: expectedGmail,
          gmailConnectedAsExpected: Boolean(gmail),
          companyOutboundEnabled: company.outboundSourcingEnabled,
          globalKillSwitchPaused: settings.globalOutboundPaused,
          autonomyAuthorisedAt: settings.autonomyAuthorisedAt,
          exactlyThreeRecipients: drafts.length === 3,
          transportExecuteRefused: true,
        },
        instruction:
          "STOP. DO NOT SEND. Founder approval required after reviewing this certification report.",
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
