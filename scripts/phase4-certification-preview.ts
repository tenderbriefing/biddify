/**
 * Phase 4 certification preview for ONE RFQ / ONE company / 2–3 suppliers.
 * Creates DRAFT sourcing requests only. Does NOT send email.
 * Founder must approve the printed batch before any send.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { selectBiddingCompany } from "../src/domain/companySelection";
import { generateSupplierEnquiryDraft } from "../src/domain/supplierEnquiry";
import { calculateCostConfidence, calculateSpecConfidence } from "../src/domain/costConfidence";
import { calculateBidPriority } from "../src/domain/bidPriority";
import { evaluateCommercialGate } from "../src/domain/commercialGate";
import { writeAuditEvent } from "../src/lib/audit";
import { isValidPublishedEmail } from "../src/domain/operationalGuards";

function sourcingRef(internalId: string, n: number) {
  return `${internalId}-SRC-${String(n).padStart(3, "0")}`;
}

async function main() {
  const settings = await prisma.systemSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      outboundMode: "CERTIFICATION",
      globalOutboundPaused: true,
      notes: "Certification mode — Founder approval required per batch",
    },
    update: {
      outboundMode: "CERTIFICATION",
      // Keep paused until Founder approves certification send
      globalOutboundPaused: true,
    },
  });

  const rfq = await prisma.rfq.findFirst({
    where: { internalId: "BID-000011", isRealSource: true },
    include: {
      lineItems: { orderBy: { lineNumber: "asc" } },
      quotes: { include: { lineItems: true } },
      pricingScenarios: { where: { isSelected: true }, take: 1 },
    },
  });
  if (!rfq) throw new Error("BID-000011 not found");

  // Detach DEMO company if still selected
  if (rfq.selectedCompanyId) {
    const selected = await prisma.company.findUnique({
      where: { id: rfq.selectedCompanyId },
    });
    if (selected?.isDemo) {
      await prisma.rfq.update({
        where: { id: rfq.id },
        data: { selectedCompanyId: null },
      });
    }
  }

  const companies = await prisma.company.findMany({
    where: { isDemo: false, dataMode: "OPERATIONAL", isActive: true },
  });
  const gmailByCompany = await prisma.gmailAccount.findMany({
    where: { companyId: { not: null }, connectionStatus: "CONNECTED" },
  });
  const mapped = new Set(gmailByCompany.map((g) => g.companyId!));

  const selection = selectBiddingCompany({
    rfq: {
      isRealSource: true,
      isDemo: false,
      province: rfq.province,
      category: rfq.category,
      title: rfq.title,
      classification: rfq.classification,
    },
    companies: companies.map((c) => ({
      id: c.id,
      legalName: c.legalName,
      isDemo: c.isDemo,
      dataMode: c.dataMode,
      isActive: c.isActive,
      outboundSourcingEnabled: c.outboundSourcingEnabled,
      readinessOverall: c.readinessOverall,
      readinessBlockers: c.readinessDetails
        ? (JSON.parse(c.readinessDetails) as { blockers?: string[] }).blockers ??
          []
        : [],
      province: c.province,
      commodityCategories: c.commodityCategories,
      commodityNotes: c.commodityNotes,
      hasMappedGmail: mapped.has(c.id),
      relatedCompanyGroupId: c.relatedCompanyGroupId,
      vatStatusKnown: c.vatStatusKnown,
    })),
  });

  if (!selection.recommendedCompanyId) {
    throw new Error(`No company recommended: ${selection.blockers.join("; ")}`);
  }

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: selection.recommendedCompanyId },
  });

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      selectedCompanyId: company.id,
      recommendedCompanyId: company.id,
      companySelectionReason: JSON.stringify(selection.reasoning),
      companySelectionBlockers: JSON.stringify(selection.blockers),
      dataMode: "OPERATIONAL",
      isDemo: false,
      sourcingStrategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
    },
  });

  // Operational suppliers only — email must be verified; never invent.
  // Phase 3 placeholder .invalid addresses are explicitly excluded.
  await prisma.supplier.updateMany({
    where: {
      OR: [
        { email: { endsWith: ".invalid" } },
        { email: { contains: "example." } },
        { isDemo: true },
      ],
    },
    data: {
      emailVerified: false,
      dataMode: "TEST",
      notes: "Placeholder/DEMO — not eligible for operational outbound",
    },
  });

  const candidateSuppliers = [
    {
      name: "Makro South Africa (Massmart)",
      website: "https://www.makro.co.za",
      supplierType: "wholesaler",
      categories: "Consumables, cleaning, batteries, paper products",
      discoverySource: "PUBLIC_WEB — makro.co.za",
      evidenceUrl: "https://www.makro.co.za",
      // No verified published quote inbox confirmed in Phase 4 evidence — leave null.
      email: null as string | null,
      emailEvidence: null as string | null,
    },
    {
      name: "Bidvest Waltons",
      website: "https://www.waltons.co.za",
      supplierType: "wholesaler",
      categories: "Office and facility consumables",
      discoverySource: "PUBLIC_WEB — waltons.co.za",
      evidenceUrl: "https://www.waltons.co.za",
      email: null,
      emailEvidence: null,
    },
    {
      name: "Duracell (brand / authorised channel — SA)",
      website: "https://www.duracell.com",
      supplierType: "OEM",
      categories: "Batteries",
      discoverySource: "PUBLIC_WEB — brand site",
      evidenceUrl: "https://www.duracell.com",
      email: null,
      emailEvidence: null,
    },
  ];

  const suppliers = [];
  for (const def of candidateSuppliers) {
    let s = await prisma.supplier.findFirst({ where: { name: def.name } });
    const email =
      def.email && isValidPublishedEmail(def.email) ? def.email : null;
    if (!s) {
      s = await prisma.supplier.create({
        data: {
          name: def.name,
          website: def.website,
          supplierType: def.supplierType,
          categories: def.categories,
          discoverySource: def.discoverySource,
          evidenceUrl: def.evidenceUrl,
          email,
          emailVerified: Boolean(email && def.emailEvidence),
          emailEvidence: def.emailEvidence,
          verificationStatus: email ? "CONTACT_PENDING" : "UNVERIFIED",
          dataMode: "OPERATIONAL",
          isDemo: false,
          notes:
            "Real supplier identity from public web. Quote email NOT verified — Founder must supply/confirm published contact before certification send.",
        },
      });
    } else {
      s = await prisma.supplier.update({
        where: { id: s.id },
        data: {
          email,
          emailVerified: Boolean(email && def.emailEvidence),
          emailEvidence: def.emailEvidence,
          dataMode: "OPERATIONAL",
          isDemo: false,
        },
      });
    }
    suppliers.push(s);
  }

  // Build certification drafts only for suppliers with verified emails.
  const sendable = suppliers.filter((s) => s.emailVerified && s.email);
  let seq = 1;
  const drafts = [];
  for (const supplier of sendable.slice(0, 3)) {
    const reference = sourcingRef(rfq.internalId, seq++);
    const idempotencyKey = `${rfq.id}:${supplier.id}:${reference}`;
    const existing = await prisma.sourcingRequest.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      drafts.push(existing);
      continue;
    }
    const enquiry = generateSupplierEnquiryDraft({
      rfqInternalId: rfq.internalId,
      tenderNumber: rfq.tenderNumber,
      buyer: rfq.buyer,
      deliveryDestination: "Cydna Lab",
      deliveryAddress: rfq.deliveryAddress,
      deliveryDeadline: "As per RFQ / PO confirmation",
      supplierName: supplier.name,
      lines: rfq.lineItems.map((l) => ({
        lineNumber: l.lineNumber,
        description: l.description,
        specification: l.specification,
        quantity: Number(l.quantity),
        unit: l.unit,
        brandRequirement: l.brandRequirement,
        equivalentAllowed: l.equivalentAllowed,
      })),
    });
    const subject = `[${reference}] ${enquiry.subject}`;
    const body = `${enquiry.body}\n\nInternal sourcing reference: ${reference}\nPlease quote this reference on your reply.\n`;
    const created = await prisma.sourcingRequest.create({
      data: {
        reference,
        rfqId: rfq.id,
        companyId: company.id,
        supplierId: supplier.id,
        idempotencyKey,
        recipientEmail: supplier.email!,
        subject,
        body,
        strategy: "FORMAL_SUPPLIER_QUOTE_REQUIRED",
        deliveryState: "DRAFT_NOT_SENT",
        certificationBatch: true,
      },
    });
    drafts.push(created);
  }

  const cost = calculateCostConfidence({
    evidenceTypes: rfq.quotes.map((q) => q.evidenceType),
    independentSupplierCount: new Set(rfq.quotes.map((q) => q.supplierId)).size,
    quoteAgeDays: 1,
    specMatchKnown: false,
    stockConfirmed: false,
    deliveryConfirmed: false,
    vatClarity: true,
    leadTimeClarity: false,
  });
  const matches = rfq.quotes.flatMap((q) =>
    q.lineItems.map((l) => l.matchState),
  );
  const spec = calculateSpecConfidence({ matches });
  const pricing = rfq.pricingScenarios[0];
  const hoursToClose =
    (rfq.closingAt.getTime() - Date.now()) / 3600000;
  const priority = pricing
    ? calculateBidPriority({
        expectedGrossProfit: Number(pricing.grossProfit),
        grossMarginPercent: Number(pricing.grossMarginPercent),
        workingCapitalRequired: Number(
          pricing.upfrontCashRequired ?? pricing.workingCapitalRequired,
        ),
        costConfidence: cost.score,
        specConfidence: spec.score,
        hoursToClose,
        complianceReady: company.readinessOverall === "READY",
        supplierReady: sendable.length >= 2,
        commercialGate: rfq.profitabilityGate,
      })
    : null;

  const gate = evaluateCommercialGate({
    specificationsClear: true,
    lineItemsVerified: rfq.lineItems.every(
      (l) => l.verificationStatus === "VERIFIED",
    ),
    supplierIdentified: suppliers.length > 0,
    hasSupplierQuote: rfq.quotes.some((q) => q.evidenceType === "SUPPLIER_QUOTE"),
    hasPriceEvidence: rfq.quotes.length > 0,
    bestEvidenceType: rfq.quotes.some((q) => q.evidenceType === "SUPPLIER_QUOTE")
      ? "SUPPLIER_QUOTE"
      : "PUBLIC_PRICE_REFERENCE",
    productsCompliant: "UNKNOWN",
    deliveryFeasible: "UNKNOWN",
    complianceFeasible: company.readinessOverall === "READY" ? "UNKNOWN" : false,
    workingCapitalIntensity: "MEDIUM",
    grossProfit: pricing ? Number(pricing.grossProfit) : 0,
    grossMarginPercent: pricing ? Number(pricing.grossMarginPercent) : 0,
    allPricesKnown: true,
    deliveryCostKnown: true,
    realBiddingCompany: true,
    companyCompliant:
      company.readinessOverall === "READY" ? "UNKNOWN" : false,
    vatTreatmentKnown: company.vatStatusKnown,
    workingCapitalUnderstood: Boolean(pricing),
  });

  await prisma.rfq.update({
    where: { id: rfq.id },
    data: {
      costConfidence: cost.score,
      costConfidenceReasons: JSON.stringify(cost.reasons),
      specConfidence: spec.score,
      specConfidenceReasons: JSON.stringify(spec.reasons),
      bidPriority: priority?.priority,
      bidPriorityReasons: priority ? JSON.stringify(priority.reasons) : null,
      capitalEfficiency: priority?.capitalEfficiency,
      profitabilityGate: gate.gate,
      inFounderBidQueue: gate.gate !== "RED",
      status: "SOURCING",
      nextAction:
        sendable.length === 0
          ? "SOURCE_SUPPLIERS"
          : "REQUEST_QUOTES",
      nextActionReason:
        sendable.length === 0
          ? "Await Founder-confirmed verified supplier emails for certification batch"
          : "Certification drafts ready — Founder approval required before send",
    },
  });

  await writeAuditEvent({
    action: "CERTIFICATION_PREVIEW",
    entityType: "Rfq",
    entityId: rfq.id,
    metadata: {
      company: company.legalName,
      draftCount: drafts.length,
      sendableSuppliers: sendable.map((s) => s.name),
      blockedWithoutEmail: suppliers
        .filter((s) => !s.emailVerified)
        .map((s) => s.name),
      outboundMode: settings.outboundMode,
      globalPaused: true,
    },
  });

  const gmail = await prisma.gmailAccount.findFirst({
    where: { companyId: company.id },
  });

  console.log(
    JSON.stringify(
      {
        CERTIFICATION_PREVIEW: true,
        SEND_EXECUTED: false,
        rfq: rfq.internalId,
        company: {
          legalName: company.legalName,
          registrationNumber: company.registrationNumber,
          csd: company.csdMaaaNumber,
          vatRegistered: company.vatRegistered,
          readiness: company.readinessOverall,
          outboundEnabled: company.outboundSourcingEnabled,
        },
        companySelection: selection,
        gmail: gmail
          ? {
              email: gmail.emailAddress,
              mapped: true,
              sendingEnabled: gmail.sendingEnabled,
              status: gmail.connectionStatus,
            }
          : {
              email: null,
              mapped: false,
              note: "Connect Gmail via /settings/gmail and map to this company — do not guess account",
            },
        suppliers: suppliers.map((s) => ({
          name: s.name,
          email: s.email,
          emailVerified: s.emailVerified,
          website: s.website,
        })),
        certificationDrafts: drafts.map((d) => ({
          reference: d.reference,
          to: d.recipientEmail,
          subject: d.subject,
          state: d.deliveryState,
          certificationBatch: d.certificationBatch,
        })),
        blockersToSend: [
          ...(gmail ? [] : ["Gmail not connected/mapped"]),
          ...(gmail && !gmail.sendingEnabled ? ["Gmail sending disabled"] : []),
          ...(!company.outboundSourcingEnabled
            ? ["Company outbound disabled"]
            : []),
          ...(settings.globalOutboundPaused
            ? ["Global kill switch PAUSED"]
            : []),
          ...(sendable.length < 2
            ? [
                "Fewer than 2 suppliers with verified published emails — Founder must confirm real quote inboxes before certification send",
              ]
            : []),
          "Founder certification approval not yet recorded",
        ],
        costConfidence: cost,
        specConfidence: spec,
        commercialGate: gate,
        bidPriority: priority,
        instruction:
          "STOP — review this preview. Provide/confirm 2–3 verified supplier emails + map Gmail, then approve certification batch to send.",
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
