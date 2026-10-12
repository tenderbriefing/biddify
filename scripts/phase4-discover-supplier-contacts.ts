/**
 * Discover and persist verified supplier contact channels for BID-000011 product groups.
 * Evidence-backed only — never invent emails.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { writeAuditEvent } from "../src/lib/audit";
import { isValidPublishedEmail } from "../src/domain/operationalGuards";

type Discovered = {
  name: string;
  website: string;
  supplierType: string;
  categories: string;
  brands: string;
  location: string;
  relevance: string;
  channels: Array<{
    channelType: "EMAIL" | "WEB_QUOTE_FORM" | "WEB_CONTACT_FORM" | "PHONE";
    email?: string;
    phone?: string;
    url?: string;
    sourceUrl: string;
    sourceType: string;
    purpose: string;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    isPrimaryQuoteChannel?: boolean;
    evidenceNotes: string;
  }>;
};

const DISCOVERED: Discovered[] = [
  {
    name: "Erom Wholesalers",
    website: "https://erom.co.za/",
    supplierType: "wholesaler",
    categories:
      "Cleaning consumables, paper products, batteries, dry groceries (mining/manufacture/service)",
    brands: "Sunlight dishwashing; paper towel reels; Duracell or equivalents",
    location: "Roodepoort / Johannesburg, Gauteng",
    relevance:
      "Official site lists dishwashing liquid, paper towels (reel/jumbo), and Duracell batteries — covers all BID-000011 product groups.",
    channels: [
      {
        channelType: "EMAIL",
        email: "sales@erom.co.za",
        sourceUrl: "https://erom.co.za/",
        sourceType: "OFFICIAL_WEBSITE_CONTACT",
        purpose: "SALES_QUOTATION",
        confidence: "HIGH",
        isPrimaryQuoteChannel: true,
        evidenceNotes:
          "Published on official homepage CONTACT US as Email Sales: sales@erom.co.za (verified fetch 2026-10-12).",
      },
      {
        channelType: "EMAIL",
        email: "eromwhol@mweb.co.za",
        sourceUrl: "https://erom.co.za/",
        sourceType: "OFFICIAL_WEBSITE_CONTACT",
        purpose: "GENERAL",
        confidence: "HIGH",
        evidenceNotes: "Published on official homepage as Email General.",
      },
      {
        channelType: "PHONE",
        phone: "0117686285",
        sourceUrl: "https://erom.co.za/",
        sourceType: "OFFICIAL_WEBSITE_CONTACT",
        purpose: "GENERAL",
        confidence: "HIGH",
        evidenceNotes: "Published phone on official homepage.",
      },
    ],
  },
  {
    name: "Bidvest Waltons",
    website: "https://www.waltons.co.za",
    supplierType: "wholesaler",
    categories: "Office, facility and stationery consumables; bulk/tender quotes",
    brands: "Various; batteries and facility consumables via quotes desk",
    location: "National incl. Johannesburg",
    relevance:
      "National commercial stationery/facility supplier; official FAQ directs tender/bulk quotation requests to rfq@waltons.co.za.",
    channels: [
      {
        channelType: "EMAIL",
        email: "rfq@waltons.co.za",
        sourceUrl: "https://www.waltons.co.za/faq",
        sourceType: "OFFICIAL_WEBSITE_FAQ",
        purpose: "QUOTATION_TENDER",
        confidence: "HIGH",
        isPrimaryQuoteChannel: true,
        evidenceNotes:
          'Official FAQ: "How do I get a quote, place a bulk order, or respond to a tender? Email our quotes team at rfq@waltons.co.za" (verified fetch 2026-10-12).',
      },
      {
        channelType: "WEB_QUOTE_FORM",
        url: "https://www.waltons.co.za/contact",
        sourceUrl: "https://www.waltons.co.za/faq",
        sourceType: "OFFICIAL_WEBSITE_FAQ",
        purpose: "QUOTATION",
        confidence: "HIGH",
        evidenceNotes:
          'FAQ also offers contact form option "I need a quote" — not used for Gmail certification.',
      },
      {
        channelType: "EMAIL",
        email: "helpdesk@gp.waltons.co.za",
        sourceUrl: "https://www.eline.waltons.co.za/Pages/About/AboutFFF.aspx",
        sourceType: "OFFICIAL_EBUSINESS_PAGE",
        purpose: "EBUSINESS_HELPDESK",
        confidence: "MEDIUM",
        evidenceNotes:
          "e-Business helpdesk — not primary tender quotation channel; do not use for certification.",
      },
    ],
  },
  {
    name: "Makro South Africa (Massmart)",
    website: "https://www.makro.co.za",
    supplierType: "wholesaler",
    categories: "Trade/wholesale consumables, cleaning, batteries, paper",
    brands: "Various incl. Duracell commonly stocked",
    location: "National incl. Johannesburg",
    relevance:
      "Trade wholesale for consumables; commercial channel documented. Primary public contact is commercial online / general support rather than a dedicated tender RFQ desk.",
    channels: [
      {
        channelType: "EMAIL",
        email: "commercialonline@makro.co.za",
        sourceUrl:
          "https://www.makro.co.za/sys-master/images/h6c/hcc/10304355794974/Commercial_Customer_Introduction_Document.pdf",
        sourceType: "OFFICIAL_COMMERCIAL_PDF",
        purpose: "COMMERCIAL_ONLINE",
        confidence: "MEDIUM",
        isPrimaryQuoteChannel: true,
        evidenceNotes:
          "Published in official Makro Commercial Customer Introduction PDF beside commercial online contact centre number 0860 409 999 (verified PDF extract 2026-10-12). Suitable commercial channel; not labelled as tender RFQ desk.",
      },
      {
        channelType: "EMAIL",
        email: "info@makro.co.za",
        sourceUrl: "https://www.makro.co.za/pages/contactus",
        sourceType: "OFFICIAL_CONTACT_PAGE",
        purpose: "GENERAL_CUSTOMER_SERVICE",
        confidence: "HIGH",
        evidenceNotes:
          "Official contact page general enquiries email — not preferred for formal quotation certification.",
      },
      {
        channelType: "WEB_CONTACT_FORM",
        url: "https://business.makro.co.za/contactus",
        sourceUrl: "https://business.makro.co.za/contactus",
        sourceType: "OFFICIAL_BUSINESS_PORTAL",
        purpose: "BUSINESS_CONTACT",
        confidence: "MEDIUM",
        evidenceNotes:
          "Makro Business portal contact page — form channel, not Gmail certification email.",
      },
    ],
  },
  {
    name: "Primo Wholesalers",
    website: "https://primowholesalers.co.za/",
    supplierType: "wholesaler",
    categories: "FMCG cleaning, hygiene, batteries",
    brands: "Sunlight dishwashing; Energizer batteries (not Duracell)",
    location: "Edenvale, Gauteng",
    relevance:
      "Gauteng wholesaler for dishwashing/cleaning and batteries; AAA Duracell brand line may require alternative brand check — keep as reserve, not primary Duracell source.",
    channels: [
      {
        channelType: "EMAIL",
        email: "info@primowholesalers.co.za",
        sourceUrl: "https://primowholesalers.co.za/",
        sourceType: "OFFICIAL_WEBSITE_CONTACT",
        purpose: "GENERAL_SALES",
        confidence: "HIGH",
        isPrimaryQuoteChannel: true,
        evidenceNotes:
          "Published on official homepage Contact Details (verified fetch 2026-10-12).",
      },
    ],
  },
];

async function main() {
  const verifiedAt = new Date();
  const results = [];

  for (const def of DISCOVERED) {
    let supplier = await prisma.supplier.findFirst({ where: { name: def.name } });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: {
          name: def.name,
          website: def.website,
          supplierType: def.supplierType,
          categories: def.categories,
          brands: def.brands,
          location: def.location,
          discoverySource: "PUBLIC_OFFICIAL_WEB",
          evidenceUrl: def.website,
          verificationStatus: "CONTACT_VERIFIED",
          dataMode: "OPERATIONAL",
          isDemo: false,
          notes: def.relevance,
        },
      });
    } else {
      supplier = await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          website: def.website,
          supplierType: def.supplierType,
          categories: def.categories,
          brands: def.brands,
          location: def.location,
          discoverySource: "PUBLIC_OFFICIAL_WEB",
          evidenceUrl: def.website,
          dataMode: "OPERATIONAL",
          isDemo: false,
          notes: def.relevance,
        },
      });
    }

    // Clear prior discovery rows for idempotent re-run of this script's channels
    await prisma.supplierContactChannel.deleteMany({
      where: { supplierId: supplier.id },
    });

    const primaryEmail = def.channels.find(
      (c) => c.isPrimaryQuoteChannel && c.channelType === "EMAIL" && c.email,
    );

    for (const ch of def.channels) {
      if (ch.email && !isValidPublishedEmail(ch.email)) {
        throw new Error(`Invalid email rejected: ${ch.email}`);
      }
      await prisma.supplierContactChannel.create({
        data: {
          supplierId: supplier.id,
          channelType: ch.channelType,
          email: ch.email,
          phone: ch.phone,
          url: ch.url,
          sourceUrl: ch.sourceUrl,
          sourceType: ch.sourceType,
          purpose: ch.purpose,
          confidence: ch.confidence,
          verifiedAt,
          evidenceNotes: ch.evidenceNotes,
          isPrimaryQuoteChannel: Boolean(ch.isPrimaryQuoteChannel),
        },
      });
    }

    if (primaryEmail?.email) {
      await prisma.supplier.update({
        where: { id: supplier.id },
        data: {
          email: primaryEmail.email,
          emailVerified: true,
          emailEvidence: `${primaryEmail.sourceUrl} · ${primaryEmail.evidenceNotes}`,
          verificationStatus: "EMAIL_VERIFIED",
        },
      });
    }

    await writeAuditEvent({
      action: "SUPPLIER_DISCOVERED",
      entityType: "Supplier",
      entityId: supplier.id,
      metadata: {
        channels: def.channels.length,
        primaryEmail: primaryEmail?.email ?? null,
        relevance: def.relevance,
      },
    });

    results.push({
      supplier: def.name,
      primaryQuoteEmail: primaryEmail?.email ?? null,
      confidence: primaryEmail?.confidence ?? null,
      sourceUrl: primaryEmail?.sourceUrl ?? null,
      relevance: def.relevance,
    });
  }

  console.log(JSON.stringify({ discovered: results, verifiedAt }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
