import { describe, expect, it } from "vitest";
import { generateSupplierEnquiryDraft } from "./supplierEnquiry";

describe("supplier enquiry drafts", () => {
  it("generates DRAFT_NOT_SENT professional enquiry", () => {
    const draft = generateSupplierEnquiryDraft({
      rfqInternalId: "BID-000011",
      tenderNumber: "JW-RFQ-1",
      buyer: "Johannesburg Water",
      deliveryDestination: "Cydna Lab",
      deliveryAddress: "65 Ntemi Piliso Street",
      deliveryDeadline: "As per RFQ",
      supplierName: "Makro South Africa",
      lines: [
        {
          lineNumber: 1,
          description: "Dishwashing liquid 750ml",
          specification: "750ml dishwashing liquid",
          quantity: 120,
          unit: "EA",
          equivalentAllowed: true,
        },
      ],
    });
    expect(draft.deliveryState).toBe("DRAFT_NOT_SENT");
    expect(draft.body).toMatch(/DRAFT ONLY/);
    expect(draft.body).toMatch(/VAT-inclusive or VAT-exclusive/);
    expect(draft.body).toMatch(/Delivery cost/);
    expect(draft.subject).toMatch(/BID-000011/);
  });
});
