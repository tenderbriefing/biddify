import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { calculatePricing } from "../src/domain/pricing";
import { recommendProfitability } from "../src/domain/profitability";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding Biddify DEMO data…");

  await prisma.auditEvent.deleteMany();
  await prisma.approval.deleteMany();
  await prisma.bid.deleteMany();
  await prisma.pricingLineItem.deleteMany();
  await prisma.pricingScenario.deleteMany();
  await prisma.supplierQuoteLineItem.deleteMany();
  await prisma.supplierQuote.deleteMany();
  await prisma.complianceRequirement.deleteMany();
  await prisma.rfqDocument.deleteMany();
  await prisma.rfqRequirement.deleteMany();
  await prisma.rfqLineItem.deleteMany();
  await prisma.rfqStatusEvent.deleteMany();
  await prisma.rfq.deleteMany();
  await prisma.companyDocument.deleteMany();
  await prisma.company.deleteMany();
  await prisma.supplierContact.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.emailMessage.deleteMany();
  await prisma.user.deleteMany();

  const passwordHash = await bcrypt.hash("demo-password-change-me", 10);

  const founder = await prisma.user.create({
    data: {
      email: "founder@demo.biddify.local",
      name: "DEMO Founder",
      passwordHash,
      role: "FOUNDER",
      isDemo: true,
    },
  });

  await prisma.user.createMany({
    data: [
      {
        email: "admin@demo.biddify.local",
        name: "DEMO Admin",
        passwordHash,
        role: "ADMIN",
        isDemo: true,
      },
      {
        email: "bidmanager@demo.biddify.local",
        name: "DEMO Bid Manager",
        passwordHash,
        role: "BID_MANAGER",
        isDemo: true,
      },
      {
        email: "reviewer@demo.biddify.local",
        name: "DEMO Reviewer",
        passwordHash,
        role: "REVIEWER",
        isDemo: true,
      },
      {
        email: "readonly@demo.biddify.local",
        name: "DEMO Read Only",
        passwordHash,
        role: "READ_ONLY",
        isDemo: true,
      },
    ],
  });

  const companyA = await prisma.company.create({
    data: {
      legalName: "DEMO Supply Co (Pty) Ltd",
      tradingName: "DEMO Supply Co",
      registrationNumber: "DEMO-REG-001",
      csdNumber: "DEMO-CSD-001",
      vatRegistered: false,
      beeLevel: "Level 2",
      province: "Gauteng",
      contactName: "DEMO Contact A",
      contactEmail: "ops@demo-supply.local",
      contactPhone: "+27 11 000 0001",
      commodityNotes: "Office supplies, IT peripherals, PPE, cleaning",
      geographicCoverage: "Gauteng, Free State, North West",
      notes: "DEMO company — not VAT registered. Do not use for real bids.",
      isDemo: true,
      dataMode: "TEST",
      vatStatusKnown: true,
      outboundSourcingEnabled: false,
      documents: {
        create: [
          {
            documentType: "CSD",
            title: "DEMO CSD Registration",
            verificationState: "VERIFIED",
            isDemo: true,
          },
          {
            documentType: "TAX",
            title: "DEMO Tax Clearance",
            expiryDate: new Date(Date.now() + 90 * 86400000),
            verificationState: "AVAILABLE",
            isDemo: true,
          },
          {
            documentType: "BEE",
            title: "DEMO B-BBEE Certificate",
            expiryDate: new Date(Date.now() + 120 * 86400000),
            verificationState: "AVAILABLE",
            isDemo: true,
          },
        ],
      },
    },
  });

  const companyB = await prisma.company.create({
    data: {
      legalName: "DEMO Logistics Trading (Pty) Ltd",
      tradingName: "DEMO Logistics",
      registrationNumber: "DEMO-REG-002",
      vatRegistered: true,
      vatNumber: "DEMO-VAT-002",
      beeLevel: "Level 1",
      province: "Western Cape",
      contactName: "DEMO Contact B",
      contactEmail: "bids@demo-logistics.local",
      commodityNotes: "IT equipment, furniture, appliances",
      geographicCoverage: "Western Cape, Eastern Cape",
      notes: "DEMO company — VAT registered for VAT logic testing only.",
      isDemo: true,
      dataMode: "TEST",
      vatStatusKnown: true,
      outboundSourcingEnabled: false,
    },
  });

  const supplierA = await prisma.supplier.create({
    data: {
      name: "DEMO Office Wholesale",
      email: "quotes@demo-office-wholesale.local",
      telephone: "+27 11 000 1000",
      categories: "Stationery, Office supplies, Consumables",
      brands: "DEMO Brand A",
      geographicCoverage: "National",
      paymentTerms: "30 days COD for new accounts",
      deliveryCapability: "Gauteng 2-3 days",
      notes: "DEMO supplier — reliable for stationery RFQs.",
      isDemo: true,
      dataMode: "TEST",
      emailVerified: false,
      contacts: {
        create: [
          {
            name: "DEMO Sales Desk",
            email: "quotes@demo-office-wholesale.local",
            isPrimary: true,
            role: "Sales",
          },
        ],
      },
    },
  });

  const supplierB = await prisma.supplier.create({
    data: {
      name: "DEMO IT Distributors",
      email: "tenders@demo-it-dist.local",
      categories: "Laptops, Monitors, Networking, Printers",
      brands: "DEMO OEM X, DEMO OEM Y",
      paymentTerms: "50% deposit, balance on delivery",
      deliveryCapability: "Major metros 5-7 days",
      notes: "DEMO supplier — IT equipment specialist.",
      isDemo: true,
      dataMode: "TEST",
      emailVerified: false,
      contacts: {
        create: [
          {
            name: "DEMO Account Manager",
            email: "tenders@demo-it-dist.local",
            isPrimary: true,
          },
        ],
      },
    },
  });

  const supplierC = await prisma.supplier.create({
    data: {
      name: "DEMO Industrial Supplies",
      email: "rfq@demo-industrial.local",
      categories: "PPE, Tools, Hardware, Cleaning",
      geographicCoverage: "Gauteng, KZN",
      paymentTerms: "COD",
      isDemo: true,
      dataMode: "TEST",
      emailVerified: false,
    },
  });

  const now = Date.now();
  const hours = (h: number) => new Date(now + h * 3600000);
  const days = (d: number) => new Date(now + d * 86400000);

  // RFQ 1 — stationery, pricing ready, non-VAT company
  const pricing1 = calculatePricing({
    supplierCost: 85000,
    delivery: 2500,
    logistics: 800,
    contingency: 1000,
    markupPercent: 20,
    vatRegistered: false,
    workingCapitalRequired: 87500,
  });
  const gate1 = recommendProfitability({
    pricing: pricing1,
    customerPaymentDays: 30,
    hoursToDeadline: 5 * 24,
  });

  const rfq1 = await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0001",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0001",
      sourceReference: "DEMO-ETENDER-1001",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: true,
      tenderNumber: "RFQ/DEMO/2026/001",
      buyer: "DEMO Municipality Procurement",
      department: "Corporate Services",
      title: "DEMO — Supply and Deliver Office Stationery",
      description:
        "DEMO RFQ for ordinary commercially available stationery items.",
      category: "Office supplies",
      province: "Gauteng",
      municipality: "DEMO City",
      deliveryAddress: "DEMO Civic Centre, Johannesburg",
      closingAt: days(5),
      submissionMethod: "EMAIL",
      submissionEmail: "procurement@demo-municipality.local",
      paymentTerms: "30 days after delivery",
      deliveryPeriod: "14 days after PO",
      status: "FOUNDER_REVIEW",
      opportunityScore: 78,
      commercialScore: 72,
      complianceScore: 80,
      profitabilityGate: gate1.gate,
      opportunityScoreNotes:
        "Supply-and-deliver fit; clear specs; supplier available. DEMO data.",
      selectedCompanyId: companyA.id,
      isDemo: true,
      dataMode: "TEST",
      lineItems: {
        create: [
          {
            lineNumber: 1,
            product: "A4 Copy Paper",
            description: "A4 80gsm white copy paper, reams",
            specification: "80gsm, 500 sheets/ream",
            quantity: 500,
            unit: "REAM",
            equivalentAllowed: true,
          },
          {
            lineNumber: 2,
            product: "Ballpoint Pens",
            description: "Blue ballpoint pens, box of 50",
            quantity: 200,
            unit: "BOX",
            equivalentAllowed: true,
          },
          {
            lineNumber: 3,
            product: "Lever Arch Files",
            description: "A4 lever arch files, assorted colours",
            quantity: 300,
            unit: "EA",
            equivalentAllowed: true,
          },
        ],
      },
      requirements: {
        create: [
          {
            category: "Mandatory",
            description: "Valid CSD registration",
            isMandatory: true,
            sourceHint: "DEMO RFQ clause 5.1",
          },
          {
            category: "Mandatory",
            description: "Signed quotation on company letterhead",
            isMandatory: true,
          },
          {
            category: "Preference",
            description: "B-BBEE affidavit / certificate",
            isMandatory: false,
          },
        ],
      },
      documents: {
        create: [
          {
            fileName: "DEMO-RFQ-Stationery.pdf",
            documentType: "RFQ",
            isSource: true,
            isDemo: true,
            notes: "DEMO source document placeholder — not a real RFQ.",
          },
        ],
      },
      complianceItems: {
        create: [
          {
            itemKey: "csd",
            label: "CSD registration",
            isMandatory: true,
            state: "VERIFIED",
          },
          {
            itemKey: "tax",
            label: "Tax compliance",
            isMandatory: true,
            state: "AVAILABLE",
          },
          {
            itemKey: "quotation",
            label: "Signed quotation",
            isMandatory: true,
            state: "NEEDS_SIGNATURE",
          },
          {
            itemKey: "bee",
            label: "B-BBEE documentation",
            isMandatory: false,
            state: "AVAILABLE",
          },
        ],
      },
    },
    include: { lineItems: true },
  });

  await prisma.supplierQuote.create({
    data: {
      rfqId: rfq1.id,
      supplierId: supplierA.id,
      quoteReference: "DEMO-Q-STA-001",
      validUntil: days(7),
      deliveryCost: 2500,
      leadTimeDays: 5,
      paymentTerms: "30 days",
      vatIncluded: true,
      isComplete: true,
      isDemo: true,
      lineItems: {
        create: [
          {
            rfqLineItemId: rfq1.lineItems[0]?.id,
            description: "A4 80gsm copy paper",
            quantity: 500,
            unitCost: 68,
            lineTotal: 34000,
            brandOffered: "DEMO PaperCo",
          },
          {
            rfqLineItemId: rfq1.lineItems[1]?.id,
            description: "Blue ballpoint pens box/50",
            quantity: 200,
            unitCost: 95,
            lineTotal: 19000,
          },
          {
            rfqLineItemId: rfq1.lineItems[2]?.id,
            description: "A4 lever arch files",
            quantity: 300,
            unitCost: 106.67,
            lineTotal: 32000,
          },
        ],
      },
    },
  });

  const scenario1 = await prisma.pricingScenario.create({
    data: {
      rfqId: rfq1.id,
      name: "Primary 20% markup",
      markupPercent: pricing1.markupPercent,
      supplierCostTotal: pricing1.supplierCost,
      deliveryCost: pricing1.delivery,
      logisticsCost: pricing1.logistics,
      contingencyCost: pricing1.contingency,
      landedCost: pricing1.landedCost,
      sellingPriceExVat: pricing1.sellingPriceExVat,
      vatAmount: pricing1.vatAmount,
      totalQuotation: pricing1.totalQuotation,
      grossProfit: pricing1.grossProfit,
      grossMarginPercent: pricing1.grossMarginPercent,
      workingCapitalRequired: pricing1.workingCapitalRequired,
      profitabilityGate: gate1.gate,
      vatRegisteredSnapshot: false,
      isSelected: true,
      isDemo: true,
      notes: gate1.reasons.join(" | "),
    },
  });

  // RFQ 2 — IT equipment, sourcing, VAT company option
  const rfq2 = await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0002",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0002",
      sourceReference: "DEMO-ETENDER-1002",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: true,
      tenderNumber: "RFQ/DEMO/2026/002",
      buyer: "DEMO Provincial Department of Education",
      department: "ICT",
      title: "DEMO — Supply and Deliver Laptops and Monitors",
      description: "DEMO RFQ for commercially available IT equipment.",
      category: "IT equipment",
      province: "Western Cape",
      closingAt: days(2),
      submissionMethod: "PORTAL",
      submissionPortal: "https://demo-portal.local/rfq/1002",
      paymentTerms: "30 days after invoice",
      deliveryPeriod: "21 days",
      status: "SOURCING",
      opportunityScore: 70,
      commercialScore: 55,
      complianceScore: 60,
      profitabilityGate: "UNREVIEWED",
      opportunityScoreNotes:
        "Good supply-and-deliver fit; working capital risk from deposit terms.",
      selectedCompanyId: companyB.id,
      isDemo: true,
      dataMode: "TEST",
      lineItems: {
        create: [
          {
            lineNumber: 1,
            product: "Laptop",
            description: "Business laptop 16GB/512GB SSD",
            specification: "i5 or equivalent, 16GB RAM, 512GB SSD",
            brandRequirement: "Equivalent brands accepted",
            equivalentAllowed: true,
            quantity: 40,
            unit: "EA",
          },
          {
            lineNumber: 2,
            product: "Monitor",
            description: "24-inch IPS monitor",
            quantity: 40,
            unit: "EA",
            equivalentAllowed: true,
          },
        ],
      },
      requirements: {
        create: [
          {
            category: "Mandatory",
            description: "OEM / authorised reseller letter if claiming brand",
            isMandatory: true,
          },
          {
            category: "Mandatory",
            description: "Warranty minimum 12 months",
            isMandatory: true,
          },
        ],
      },
      complianceItems: {
        create: [
          {
            itemKey: "csd",
            label: "CSD registration",
            isMandatory: true,
            state: "AVAILABLE",
          },
          {
            itemKey: "oem",
            label: "OEM authorisation letter",
            isMandatory: true,
            state: "MISSING",
          },
        ],
      },
    },
  });

  await prisma.supplierQuote.create({
    data: {
      rfqId: rfq2.id,
      supplierId: supplierB.id,
      quoteReference: "DEMO-Q-IT-010",
      deliveryCost: 4500,
      leadTimeDays: 14,
      paymentTerms: "50% deposit",
      isComplete: false,
      isDemo: true,
      notes: "DEMO partial quote — monitors pending.",
      lineItems: {
        create: [
          {
            description: "Business laptop 16/512",
            quantity: 40,
            unitCost: 12500,
            lineTotal: 500000,
            brandOffered: "DEMO OEM X",
          },
        ],
      },
    },
  });

  // RFQ 3 — closing soon, action required
  await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0003",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0003",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: false,
      tenderNumber: "RFQ/DEMO/2026/003",
      buyer: "DEMO Hospital Stores",
      title: "DEMO — Supply and Deliver PPE and Cleaning Products",
      category: "PPE / Cleaning",
      province: "KwaZulu-Natal",
      closingAt: hours(18),
      submissionMethod: "EMAIL",
      submissionEmail: "stores@demo-hospital.local",
      status: "COMPLIANCE",
      opportunityScore: 65,
      profitabilityGate: "AMBER",
      selectedCompanyId: companyA.id,
      isDemo: true,
      dataMode: "TEST",
      lineItems: {
        create: [
          {
            lineNumber: 1,
            description: "Nitrile gloves, box of 100",
            quantity: 1000,
            unit: "BOX",
          },
          {
            lineNumber: 2,
            description: "Surface disinfectant 5L",
            quantity: 200,
            unit: "EA",
          },
        ],
      },
      complianceItems: {
        create: [
          {
            itemKey: "csd",
            label: "CSD registration",
            isMandatory: true,
            state: "VERIFIED",
          },
          {
            itemKey: "datasheet",
            label: "Product datasheets",
            isMandatory: true,
            state: "MISSING",
          },
        ],
      },
    },
  });

  // RFQ 4 — new / review
  await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0004",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0004",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: false,
      tenderNumber: "RFQ/DEMO/2026/004",
      buyer: "DEMO District Municipality",
      title: "DEMO — Supply and Deliver Office Furniture",
      category: "Furniture",
      province: "Free State",
      closingAt: days(10),
      submissionMethod: "PHYSICAL",
      physicalSubmission: "DEMO Tender Box, Main Building",
      status: "NEW",
      opportunityScore: 60,
      profitabilityGate: "UNREVIEWED",
      isDemo: true,
      dataMode: "TEST",
      lineItems: {
        create: [
          {
            lineNumber: 1,
            description: "Office desk 1600mm",
            quantity: 25,
            unit: "EA",
          },
          {
            lineNumber: 2,
            description: "Ergonomic office chair",
            quantity: 25,
            unit: "EA",
          },
        ],
      },
    },
  });

  // RFQ 5 — submitted
  await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0005",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0005",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: false,
      tenderNumber: "RFQ/DEMO/2026/005",
      buyer: "DEMO Water Board",
      title: "DEMO — Supply and Deliver Networking Equipment",
      category: "Networking",
      province: "Gauteng",
      closingAt: days(-3),
      submissionMethod: "EMAIL",
      status: "SUBMITTED",
      opportunityScore: 74,
      profitabilityGate: "GREEN",
      selectedCompanyId: companyB.id,
      isDemo: true,
      dataMode: "TEST",
    },
  });

  // RFQ 6 — no-bid
  await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0006",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0006",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: false,
      tenderNumber: "RFQ/DEMO/2026/006",
      buyer: "DEMO Public Works",
      title: "DEMO — Construction Grading Required Works",
      category: "Construction",
      province: "Limpopo",
      closingAt: days(8),
      status: "NO_BID",
      noBidReason: "Mandatory construction grading we do not possess",
      profitabilityGate: "RED",
      isDemo: true,
      dataMode: "TEST",
    },
  });

  // RFQ 7 — awarded (fulfilment path)
  await prisma.rfq.create({
    data: {
      internalId: "BID-DEMO-0007",
      source: "DEMO",
      sourceOpportunityId: "demo-ocds-0007",
      isRealSource: false,
      closingTimeKnown: true,
      briefingCompulsoryKnown: false,
      tenderNumber: "RFQ/DEMO/2026/007",
      buyer: "DEMO Library Services",
      title: "DEMO — Supply and Deliver Desktop Computers",
      category: "IT equipment",
      province: "Gauteng",
      closingAt: days(-20),
      status: "AWARDED",
      opportunityScore: 80,
      profitabilityGate: "GREEN",
      selectedCompanyId: companyA.id,
      isDemo: true,
      dataMode: "TEST",
    },
  });

  await prisma.bid.create({
    data: {
      rfqId: rfq1.id,
      companyId: companyA.id,
      status: "FOUNDER_REVIEW",
      approvedPrice: pricing1.totalQuotation,
      submissionMethod: "EMAIL",
      isDemo: true,
    },
  });

  await prisma.rfqStatusEvent.create({
    data: {
      rfqId: rfq1.id,
      fromStatus: "COMPLIANCE",
      toStatus: "FOUNDER_REVIEW",
      userId: founder.id,
      reason: "DEMO seed — moved to Founder review",
    },
  });

  await prisma.auditEvent.create({
    data: {
      action: "SEED_LOADED",
      entityType: "System",
      entityId: "phase-1",
      userId: founder.id,
      metadata: JSON.stringify({
        environment: "DEMO",
        companies: 2,
        suppliers: 3,
        rfqs: 7,
        pricingScenarioId: scenario1.id,
      }),
    },
  });

  // Silence unused var if tree-shaken oddly
  void (supplierC as Prisma.SupplierGetPayload<object>);

  console.log("Seed complete.");
  console.log("DEMO logins (password: demo-password-change-me):");
  console.log("  founder@demo.biddify.local (FOUNDER)");
  console.log("  admin@demo.biddify.local (ADMIN)");
  console.log("  bidmanager@demo.biddify.local (BID_MANAGER)");
  console.log("  reviewer@demo.biddify.local (REVIEWER)");
  console.log("  readonly@demo.biddify.local (READ_ONLY)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
