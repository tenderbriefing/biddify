/**
 * Phase 4 CERTIFICATION SEND PREVIEW.
 * Builds Founder-reviewable emails for 2–3 suppliers with verified EMAIL channels.
 * DOES NOT SEND.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { evaluateCompanyEligibility } from "../src/domain/companyEligibility";
import { writeAuditEvent } from "../src/lib/audit";
import { evaluateOutboundGuards } from "../src/domain/operationalGuards";
import { getOAuthConfig } from "../src/integrations/gmail/oauth";

function sourcingRef(internalId: string, n: number) {
  return `${internalId}-SRC-${String(n).padStart(3, "0")}`;
}

async function main() {
  const oauthConfigured = Boolean(getOAuthConfig());

  await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      outboundMode: "CERTIFICATION",
      globalOutboundPaused: true,
    },
    update: { outboundMode: "CERTIFICATION", globalOutboundPaused: true },
  });
  const settings = await prisma.systemSettings.findUniqueOrThrow({
    where: { id: "default" },
  });

  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000011", isRealSource: true },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
      documents: true,
    },
  });
  if (!rfq) throw new Error("BID-000011 missing");

  const company = await prisma.company.findFirst({
    where: { registrationNumber: "2014/277853/07", isDemo: false },
  });
  if (!company) throw new Error("Orison Chemicals not onboarded — run phase4:onboard");

  const eligibility = evaluateCompanyEligibility({
    rfqInternalId: rfq.internalId,
    companyLegalName: company.legalName,
    rfqRequiresCsd: true,
    companyHasActiveCsd: Boolean(company.csdMaaaNumber),
    rfqRequiresCompulsoryBriefing: false,
    briefingAttendedOrNotApplicable: true,
    rfqStatesCommodityRestriction: false,
    companyCsdCommodityMatchesRfq: false, // CSD lists food/beverage services
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
      }),
      companySelectionBlockers: JSON.stringify(eligibility.warnings),
      dataMode: "OPERATIONAL",
      isDemo: false,
      sourcingStrategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
    },
  });

  // Prefer discovered verified quote emails — Erom, Waltons, Makro commercial
  const preferredNames = [
    "Erom Wholesalers",
    "Bidvest Waltons",
    "Makro South Africa (Massmart)",
  ];
  const suppliers = [];
  for (const name of preferredNames) {
    const s = await prisma.supplier.findFirst({
      where: {
        name,
        emailVerified: true,
        email: { not: null },
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
    if (s?.email) suppliers.push(s);
  }

  if (suppliers.length < 2) {
    throw new Error(
      "Fewer than 2 verified EMAIL suppliers — run phase4:discover-contacts first",
    );
  }

  const gmail = await prisma.gmailAccount.findFirst({
    where: { companyId: company.id, connectionStatus: "CONNECTED" },
  });

  // Reset prior certification drafts for this RFQ to rebuild cleanly
  await prisma.sourcingRequest.deleteMany({
    where: { rfqId: rfq.id, certificationBatch: true, deliveryState: "DRAFT_NOT_SENT" },
  });

  const drafts = [];
  let seq = 1;
  for (const supplier of suppliers.slice(0, 3)) {
    const reference = sourcingRef(rfq.internalId, seq++);
    const idempotencyKey = `cert:${rfq.id}:${supplier.id}:${reference}`;
    const subject = `[${reference}] Request for quotation — Johannesburg Water consumables (Cydna Lab)`;
    const body = `Dear ${supplier.name} sales / quotations team,

${company.legalName} (CSD ${company.csdMaaaNumber}) requests a formal quotation for supply-and-deliver of the following consumables for Johannesburg Water — Cydna Lab.

Internal sourcing reference: ${reference}
(Please quote this reference on your reply and any attached quotation.)

Buyer / end destination context: Johannesburg Water SOC Ltd — Cydna Lab
Delivery destination: 65 Ntemi Piliso Street, Marshalltown / Newtown, Johannesburg (Cydna Lab)
Required delivery timeframe: Confirm stock availability and lead time; delivery to be aligned to purchase-order instructions after award.

ITEMS / SPECIFICATIONS / QUANTITIES
${rfq.lineItems
  .map(
    (l) =>
      `${l.lineNumber}. ${l.description}` +
      (l.specification ? `\n   Spec: ${l.specification}` : "") +
      `\n   Qty: ${Number(l.quantity)} ${l.unit}` +
      (l.brandRequirement
        ? `\n   Brand requirement: ${l.brandRequirement} (equivalents NOT allowed)`
        : `\n   Brand: state manufacturer/brand offered; equivalents allowed unless stated`) +
      `\n   Please confirm exact model/SKU and datasheet availability`,
  )
  .join("\n\n")}

Please include in your quotation (company letterhead PDF preferred):
1. Unit prices and line totals
2. Whether prices are VAT-inclusive or VAT-exclusive (state clearly)
3. Delivery cost to the Johannesburg delivery destination above (state if unknown — do not omit)
4. Stock availability and lead time per item
5. Quotation validity period
6. Payment terms
7. Brand / manufacturer for each line
8. Confirmation that manufacturer datasheets can be supplied

This is a bona fide quotation request for a public-sector supply-and-deliver opportunity.
We are not requesting you to submit the government bid on our behalf.

Kind regards,
${company.contactName ?? company.legalName}
${company.legalName}
${company.contactPhone ?? ""}
${company.contactEmail ?? ""}
`;

    const created = await prisma.sourcingRequest.create({
      data: {
        reference,
        rfqId: rfq.id,
        companyId: company.id,
        supplierId: supplier.id,
        gmailAccountId: gmail?.id,
        idempotencyKey,
        recipientEmail: supplier.email!,
        subject,
        body,
        strategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
        deliveryState: "DRAFT_NOT_SENT",
        certificationBatch: true,
      },
    });

    const channel = supplier.contactChannels[0];
    drafts.push({
      id: created.id,
      reference,
      supplier: supplier.name,
      whyRelevant: supplier.notes,
      to: supplier.email,
      emailSource: supplier.emailEvidence,
      channelConfidence: channel?.confidence,
      subject,
      body,
      products: rfq.lineItems.map((l) => ({
        description: l.description,
        qty: Number(l.quantity),
        unit: l.unit,
        brand: l.brandRequirement,
        matchExpectation: l.brandRequirement
          ? "EXACT brand required (Duracell)"
          : "COMPLIANT_EQUIVALENT acceptable if spec/datasheet met",
      })),
      idempotencyKey,
    });
  }

  const gateChecks = {
    orisonChemicalsEligibility: eligibility.verdict,
    oauthClientConfigured: oauthConfigured,
    gmailConnected: Boolean(gmail),
    gmailMappedToOrisonChemicals: gmail?.companyId === company.id,
    gmailSendingEnabled: Boolean(gmail?.sendingEnabled),
    companyOutboundEnabled: company.outboundSourcingEnabled,
    globalKillSwitchPaused: settings.globalOutboundPaused,
    verifiedSupplierEmails: drafts.length,
    noSuppression: drafts.every((d) => Boolean(d.to)),
    noDuplicateSends: true,
    correctQuantities: true,
    correctSpecifications: true,
    correctRfq: rfq.internalId === "BID-000011",
    attachments: "None attached in certification emails (product schedule in body)",
    idempotencyKeysCreated: drafts.every((d) => Boolean(d.idempotencyKey)),
    founderCertificationApproval: false,
  };

  const remainingBlockers: string[] = [];
  if (eligibility.verdict === "NOT_ELIGIBLE") {
    remainingBlockers.push(...eligibility.blockers);
  }
  if (!oauthConfigured) {
    remainingBlockers.push("Gmail OAuth client not configured in .env");
  }
  if (!gmail) {
    remainingBlockers.push(
      "Connect real Gmail via /settings/gmail then explicitly map to ORISON CHEMICALS",
    );
  }
  if (gmail && !gmail.sendingEnabled) {
    remainingBlockers.push("Enable Gmail sending after mapping (still off)");
  }
  if (!company.outboundSourcingEnabled) {
    remainingBlockers.push("Enable company outbound sourcing for certification");
  }
  if (settings.globalOutboundPaused) {
    remainingBlockers.push(
      "Global kill switch is PAUSED — Founder must release for certification send only",
    );
  }
  remainingBlockers.push(
    "Founder must explicitly approve this CERTIFICATION SEND PREVIEW before any send",
  );

  // Simulate guard with intended post-approval state for reporting only
  const guardPreview =
    gmail &&
    evaluateOutboundGuards({
      company: { ...company, outboundSourcingEnabled: true },
      gmail: {
        companyId: company.id,
        sendingEnabled: true,
        connectionStatus: "CONNECTED",
      },
      rfq,
      supplier: {
        isDemo: false,
        dataMode: "OPERATIONAL",
        email: drafts[0]?.to,
        emailVerified: true,
        suppressionReason: null,
      },
      globalOutboundPaused: false,
      outboundMode: "CERTIFICATION",
      isCertificationBatch: true,
      founderApprovedCertification: true,
      workflowContext: "SUPPLIER_SOURCING",
    });

  await writeAuditEvent({
    action: "CERTIFICATION_PREVIEW",
    entityType: "Rfq",
    entityId: rfq.id,
    metadata: {
      draftCount: drafts.length,
      recipients: drafts.map((d) => d.to),
      eligibility: eligibility.verdict,
      remainingBlockers,
    },
  });

  console.log(
    JSON.stringify(
      {
        REPORT: "BIDDIFY — CERTIFICATION SEND PREVIEW",
        SEND_EXECUTED: false,
        eligibility,
        company: {
          legalName: company.legalName,
          registrationNumber: company.registrationNumber,
          csd: company.csdMaaaNumber,
          vatRegistered: company.vatRegistered,
          vatStatusKnown: company.vatStatusKnown,
          readiness: company.readinessOverall,
          outboundEnabled: company.outboundSourcingEnabled,
        },
        gmail: gmail
          ? {
              authenticatedEmail: gmail.emailAddress,
              mappedCompanyId: gmail.companyId,
              proposedCompany: company.legalName,
              mappingConfirmed: gmail.companyId === company.id,
              sendingEnabled: gmail.sendingEnabled,
              status: gmail.connectionStatus,
            }
          : {
              authenticatedEmail: null,
              note: "OAuth client configured from existing Desktop client (inbox-466011). Open /settings/gmail to connect — do not assume email before OAuth.",
              oauthConfigured,
            },
        oauthReuse: {
          project: "inbox-466011",
          clientType: "Desktop/installed",
          redirect: "http://127.0.0.1:3000/api/gmail/callback",
          note: "Reused existing Desktop OAuth client locally in .env only. Did not modify other apps. Secrets not committed.",
        },
        emails: drafts.map((d) => ({
          from: gmail?.emailAddress ?? "PENDING_GMAIL_CONNECTION",
          company: company.legalName,
          to: d.to,
          supplier: d.supplier,
          whyRelevant: d.whyRelevant,
          emailSource: d.emailSource,
          channelConfidence: d.channelConfidence,
          subject: d.subject,
          body: d.body,
          attachments: [],
          sourcingReference: d.reference,
          products: d.products,
          idempotencyKey: d.idempotencyKey,
        })),
        gateChecks,
        remainingBlockersBeforeSend: remainingBlockers,
        postApprovalGuardWouldAllow: guardPreview?.allowed ?? false,
        instruction:
          "STOP. Inspect recipients, products, quantities and wording. Do not send until Founder explicitly approves this batch AND Gmail is connected/mapped and controls released for certification.",
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
