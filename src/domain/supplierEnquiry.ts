export type EnquiryLine = {
  lineNumber: number;
  description: string;
  specification?: string | null;
  quantity: number;
  unit: string;
  brandRequirement?: string | null;
  equivalentAllowed: boolean;
};

export type EnquiryDraftInput = {
  rfqInternalId: string;
  tenderNumber?: string | null;
  buyer: string;
  deliveryDestination?: string | null;
  deliveryAddress?: string | null;
  deliveryDeadline?: string | null;
  lines: EnquiryLine[];
  supplierName: string;
};

export type EnquiryDraft = {
  subject: string;
  body: string;
  deliveryState: "DRAFT_NOT_SENT";
  productsSummary: string;
};

export function generateSupplierEnquiryDraft(
  input: EnquiryDraftInput,
): EnquiryDraft {
  const lines = input.lines
    .map(
      (l) =>
        `${l.lineNumber}. ${l.description}` +
        (l.specification ? ` | Spec: ${l.specification}` : "") +
        ` | Qty: ${l.quantity} ${l.unit}` +
        (l.brandRequirement ? ` | Brand: ${l.brandRequirement}` : "") +
        ` | Equivalents ${l.equivalentAllowed ? "allowed" : "NOT allowed"}`,
    )
    .join("\n");

  const subject = `RFQ enquiry ${input.rfqInternalId}${input.tenderNumber ? ` / ${input.tenderNumber}` : ""} — ${input.buyer}`;

  const body = `Dear ${input.supplierName},

Please provide a formal quotation for the following supply-and-deliver requirement.

Procurement reference: ${input.rfqInternalId}${input.tenderNumber ? ` (tender/RFQ ${input.tenderNumber})` : ""}
Buyer: ${input.buyer}
Delivery destination: ${input.deliveryDestination ?? input.deliveryAddress ?? "See RFQ documents"}
Required delivery timeframe: ${input.deliveryDeadline ?? "As per RFQ / to be confirmed"}

ITEMS
${lines}

Please include in your quotation:
1. Unit prices and line totals
2. Whether prices are VAT-inclusive or VAT-exclusive (state clearly)
3. Delivery cost to the delivery destination (state if unknown — do not omit)
4. Stock availability and lead time
5. Quotation validity period
6. Payment terms
7. Brand / manufacturer and datasheet availability for each item

This message is a DRAFT ONLY and has NOT been sent.

Kind regards,
Biddify operations (draft)
`;

  return {
    subject,
    body,
    deliveryState: "DRAFT_NOT_SENT",
    productsSummary: input.lines.map((l) => l.description).join("; "),
  };
}
