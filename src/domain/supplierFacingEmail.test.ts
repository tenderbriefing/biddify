import { describe, expect, it } from "vitest";
import {
  assertNoGovernmentLeak,
  buildNeutralExternalReference,
  buildSupplierFacingEmail,
} from "./supplierFacingEmail";

describe("supplier-facing email privacy / signatory", () => {
  it("uses neutral subject and reference without government buyer or BID id", () => {
    const email = buildSupplierFacingEmail({
      supplierName: "Erom Wholesalers",
      companyLegalName: "ORISON CHEMICALS",
      externalReference: buildNeutralExternalReference(1, new Date("2026-10-12")),
      deliveryAddress: "65 Ntemi Piliso Street, Marshalltown, Johannesburg",
      deliveryNotes: "Confirm lead time for delivery to this address",
      lines: [
        {
          lineNumber: 5,
          description: "Size AAA Duracell battery",
          specification: "Size AAA battery (Duracell)",
          quantity: 150,
          unit: "EA",
          brandRequirement: "Duracell",
          equivalentAllowed: false,
        },
      ],
      signatoryName: "Operations",
      signatoryEmail: "ops@example.co.za",
    });
    expect(email.subject).toBe("Request for quotation — consumables supply");
    expect(email.externalReference).toMatch(/^RFQ-CONS-/);
    expect(assertNoGovernmentLeak(email.subject + email.body)).toEqual([]);
    expect(email.body).not.toMatch(/Johannesburg Water|Cydna|BID-000011/i);
    expect(email.body).toMatch(/Duracell/);
    expect(email.body).toMatch(/Operations/);
  });

  it("flags government opportunity leaks", () => {
    expect(assertNoGovernmentLeak("Quote for Johannesburg Water Cydna Lab BID-000011")).toEqual(
      expect.arrayContaining([
        "Johannesburg Water",
        "Cydna Lab",
        "internal BID identifier",
      ]),
    );
  });
});
