/**
 * Customer-facing quotation generation.
 * Never expose supplier cost, markup, margin, research URLs, or confidence.
 */

import { roundMoney, toNumber } from "./money";

export type QuotationCompany = {
  legalName: string;
  registrationNumber?: string | null;
  csdNumber?: string | null;
  address?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  vatRegistered: boolean;
};

export type QuotationLineInput = {
  lineNumber: number;
  description: string;
  quantity: number;
  unit: string;
  unitSellingPrice: number;
};

export type QuotationInput = {
  rfqReference: string;
  institution: string;
  quotationNumber: string;
  quotationDate: Date;
  validityDays?: number | null;
  company: QuotationCompany;
  lines: QuotationLineInput[];
  deliveryAmount?: number;
  commercialNotes?: string[];
  includeBanking?: boolean;
};

export type CustomerFacingQuotation = {
  quotationNumber: string;
  rfqReference: string;
  institution: string;
  date: string;
  validity: string | null;
  company: {
    legalName: string;
    registrationNumber?: string;
    csdNumber?: string;
    address?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    banking?: {
      bankName?: string;
      accountNumber?: string;
    };
  };
  lines: Array<{
    lineNumber: number;
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  vatTreatment: string;
  vatAmount: number;
  delivery: number;
  total: number;
  commercialNotes: string[];
  signaturePlaceholder: string;
};

const INTERNAL_LEAK_KEYS = [
  "markup",
  "margin",
  "supplierCost",
  "landedCost",
  "confidence",
  "productUrl",
  "researchUrl",
  "grossProfit",
  "evidenceLevel",
] as const;

export function generateCustomerQuotation(
  input: QuotationInput,
): CustomerFacingQuotation {
  const lines = input.lines.map((l) => {
    const unitPrice = roundMoney(toNumber(l.unitSellingPrice));
    const lineTotal = roundMoney(unitPrice * toNumber(l.quantity));
    return {
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: toNumber(l.quantity),
      unit: l.unit,
      unitPrice,
      lineTotal,
    };
  });

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const delivery = roundMoney(toNumber(input.deliveryAmount ?? 0));
  const vatRate = 15;
  const vatAmount = input.company.vatRegistered
    ? roundMoney((subtotal + delivery) * (vatRate / 100))
    : 0;
  const total = roundMoney(subtotal + delivery + vatAmount);

  const validity =
    input.validityDays != null
      ? `${input.validityDays} days from quotation date`
      : null;

  const company: CustomerFacingQuotation["company"] = {
    legalName: input.company.legalName,
  };
  if (input.company.registrationNumber) {
    company.registrationNumber = input.company.registrationNumber;
  }
  if (input.company.csdNumber) company.csdNumber = input.company.csdNumber;
  if (input.company.address) company.address = input.company.address;
  if (input.company.contactName) company.contactName = input.company.contactName;
  if (input.company.contactEmail) {
    company.contactEmail = input.company.contactEmail;
  }
  if (input.company.contactPhone) {
    company.contactPhone = input.company.contactPhone;
  }
  if (
    input.includeBanking &&
    (input.company.bankName || input.company.bankAccount)
  ) {
    company.banking = {
      bankName: input.company.bankName ?? undefined,
      accountNumber: input.company.bankAccount ?? undefined,
    };
  }

  return {
    quotationNumber: input.quotationNumber,
    rfqReference: input.rfqReference,
    institution: input.institution,
    date: input.quotationDate.toISOString().slice(0, 10),
    validity,
    company,
    lines,
    subtotal,
    vatTreatment: input.company.vatRegistered
      ? `VAT registered — VAT at ${vatRate}%`
      : "Not VAT registered — no VAT charged",
    vatAmount,
    delivery,
    total,
    commercialNotes: input.commercialNotes ?? [
      "Prices subject to stock availability at time of order.",
      "This is a draft quotation generated for Founder review — not a submitted tender.",
    ],
    signaturePlaceholder: "_________________________  Authorised signatory",
  };
}

/** Detect accidental leakage of internal commercial fields into customer JSON. */
export function detectInternalDataLeakage(customerFacing: unknown): string[] {
  const raw = JSON.stringify(customerFacing).toLowerCase();
  const leaks: string[] = [];
  for (const key of INTERNAL_LEAK_KEYS) {
    if (raw.includes(key.toLowerCase())) {
      // Allow the word "margin" only inside commercial notes prohibition text — still flag
      leaks.push(key);
    }
  }
  // URLs that look like research/product pages
  if (/https?:\/\/[^\s"]+/i.test(JSON.stringify(customerFacing))) {
    const urls = JSON.stringify(customerFacing).match(/https?:\/\/[^\s"]+/gi) ?? [];
    if (urls.length) leaks.push("url");
  }
  return [...new Set(leaks)];
}
