/**
 * Supplier-facing RFQ email content.
 * Do not expose government buyer / tender / internal BID identifiers.
 * Do not use CSD contacts as signatories.
 */

export type SupplierFacingLine = {
  lineNumber: number;
  description: string;
  specification?: string | null;
  quantity: number;
  unit: string;
  brandRequirement?: string | null;
  equivalentAllowed: boolean;
};

export type SupplierFacingEmailInput = {
  supplierName: string;
  companyLegalName: string;
  /** Neutral external reference shown to supplier (not BID-xxxxx). */
  externalReference: string;
  deliveryAddress: string;
  deliveryNotes?: string;
  lines: SupplierFacingLine[];
  signatoryName: string;
  signatoryEmail: string;
  signatoryPhone?: string | null;
};

export type SupplierFacingEmail = {
  subject: string;
  body: string;
  externalReference: string;
};

export function buildNeutralExternalReference(seq: number, date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `RFQ-CONS-${y}${m}${d}-${String(seq).padStart(3, "0")}`;
}

export function assertNoGovernmentLeak(text: string): string[] {
  const leaks: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/johannesburg\s*water/i, "Johannesburg Water"],
    [/cydna\s*lab/i, "Cydna Lab"],
    [/BID-\d+/i, "internal BID identifier"],
    [/etender/i, "eTender reference"],
    [/government tender/i, "government tender"],
    [/markup/i, "markup"],
    [/selling price/i, "selling price"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(text)) leaks.push(label);
  }
  return leaks;
}

export function buildSupplierFacingEmail(
  input: SupplierFacingEmailInput,
): SupplierFacingEmail {
  const subject = "Request for quotation — consumables supply";

  const items = input.lines
    .map((l) => {
      const brand = l.brandRequirement
        ? `Brand requirement: ${l.brandRequirement} (equivalents NOT allowed)`
        : "Brand: state manufacturer/brand offered; equivalents allowed unless stated otherwise";
      return (
        `${l.lineNumber}. ${l.description}\n` +
        (l.specification ? `   Spec: ${l.specification}\n` : "") +
        `   Qty: ${l.quantity} ${l.unit}\n` +
        `   ${brand}\n` +
        `   Please confirm exact model/SKU and datasheet availability`
      );
    })
    .join("\n\n");

  const body = `Dear ${input.supplierName} quotations team,

${input.companyLegalName} requests a formal quotation for supply and delivery of the following consumables.

Our reference: ${input.externalReference}
(Please quote this reference on your reply and any attached quotation.)

Delivery destination: ${input.deliveryAddress}
${input.deliveryNotes ? `Delivery notes: ${input.deliveryNotes}\n` : ""}
ITEMS / SPECIFICATIONS / QUANTITIES
${items}

Please include in your quotation (company letterhead PDF preferred):
1. Unit prices and line totals
2. Whether prices are VAT-inclusive or VAT-exclusive (state clearly)
3. Delivery cost to the delivery destination above (state if unknown — do not omit)
4. Stock availability and lead time per item
5. Quotation validity period
6. Payment terms
7. Brand / manufacturer for each line
8. Confirmation that manufacturer datasheets can be supplied

Kind regards,
${input.signatoryName}
${input.companyLegalName}
${input.signatoryPhone ? `${input.signatoryPhone}\n` : ""}${input.signatoryEmail}
`;

  const leaks = assertNoGovernmentLeak(`${subject}\n${body}`);
  if (leaks.length > 0) {
    throw new Error(`Supplier-facing email leaks restricted terms: ${leaks.join(", ")}`);
  }

  return { subject, body, externalReference: input.externalReference };
}
