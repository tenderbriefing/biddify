import { describe, expect, it } from "vitest";
import {
  assertApprovedSignatory,
  assertMailboxMatchesCompany,
  FORBIDDEN_SOURCING_MAILBOXES,
  resolveApprovedMailbox,
} from "./companyMailboxRegistry";
import {
  buildValidatedSourcingJob,
  executeGmailTransport,
} from "@/services/sourcing/gmailTransportBoundary";
import { buildSupplierFacingEmail } from "./supplierFacingEmail";

describe("company mailbox registry", () => {
  it("maps Orison Chemicals only to orisonchemcsd@gmail.com", () => {
    const r = resolveApprovedMailbox({
      legalName: "ORISON CHEMICALS",
      tradingName: "Orison Chemicals",
      registrationNumber: "2014/277853/07",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.approvedGmail).toBe("orisonchemcsd@gmail.com");
    }
  });

  it("hard-blocks unknown companies", () => {
    const r = resolveApprovedMailbox({ legalName: "Unknown Pty Ltd" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCKED_NO_MAILBOX_MAPPING");
  });

  it("blocks cross-company mailbox substitution for Orison Chemicals", () => {
    const forbidden = [
      "tosacacsd@gmail.com",
      "chapter28csd@gmail.com",
      "orisoncsd@gmail.com",
      "kmgcsd@gmail.com",
      "orisonsolution@gmail.com",
      "mogwena.industries@gmail.com",
      "matlaaleruocsd@gmail.com",
      "makhubela.ct@gmail.com",
      "smartprocure.ai@gmail.com",
    ];
    for (const candidate of forbidden) {
      const r = assertMailboxMatchesCompany({
        legalName: "ORISON CHEMICALS",
        tradingName: "Orison Chemicals",
        registrationNumber: "2014/277853/07",
        candidateGmail: candidate,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect([
          "BLOCKED_MAILBOX_COMPANY_MISMATCH",
          "BLOCKED_FORBIDDEN_MAILBOX",
        ]).toContain(r.code);
      }
    }
  });

  it("does not fall back when another authenticated mailbox is available", () => {
    const r = assertMailboxMatchesCompany({
      legalName: "ORISON CHEMICALS",
      tradingName: "Orison Chemicals",
      registrationNumber: "2014/277853/07",
      candidateGmail: "smartprocure.ai@gmail.com",
    });
    expect(r.ok).toBe(false);
    expect(FORBIDDEN_SOURCING_MAILBOXES).toContain(
      "smartprocure.ai@gmail.com",
    );
  });

  it("accepts only the approved Orison Chemicals mailbox", () => {
    const r = assertMailboxMatchesCompany({
      legalName: "ORISON CHEMICALS",
      tradingName: "Orison Chemicals",
      registrationNumber: "2014/277853/07",
      candidateGmail: "orisonchemcsd@gmail.com",
    });
    expect(r.ok).toBe(true);
  });

  it("blocks missing approved signatory", () => {
    const r = assertApprovedSignatory({
      authorisedSourcingSignatoryName: null,
      authorisedSourcingSignatoryConfirmedAt: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("BLOCKED_NO_APPROVED_SIGNATORY");
  });
});

describe("supplier isolation + internal ref protection", () => {
  it("keeps BID ids out of supplier-facing subjects and isolates recipients", () => {
    const erom = buildSupplierFacingEmail({
      supplierName: "Erom Wholesalers",
      companyLegalName: "ORISON CHEMICALS",
      externalReference: "RFQ-CONS-20261012-001",
      deliveryAddress: "65 Ntemi Piliso Street, Johannesburg",
      lines: [
        {
          lineNumber: 1,
          description: "DISHWASHING LIQUID 750ML",
          quantity: 60,
          unit: "EA",
          equivalentAllowed: true,
        },
      ],
      signatoryName: "Approved Signatory",
      signatoryEmail: "orisonchemcsd@gmail.com",
    });
    expect(erom.subject).toBe("Request for quotation — consumables supply");
    expect(erom.subject).not.toMatch(/BID-/i);
    expect(erom.body).toContain("Erom Wholesalers");
    expect(erom.body).not.toContain("Waltons");
    expect(erom.body).not.toContain("Makro");
    expect(erom.body).not.toContain("BID-000011");
  });
});

describe("Gmail transport boundary — preview must not send", () => {
  it("refuses execute without allowExecute even if adapter is present", async () => {
    let called = false;
    const job = buildValidatedSourcingJob({
      bidInternalId: "BID-000011",
      companyId: "co1",
      companyLegalName: "ORISON CHEMICALS",
      companyTradingName: "Orison Chemicals",
      companyRegistrationNumber: "2014/277853/07",
      approvedSenderGmail: "orisonchemcsd@gmail.com",
      supplierId: "s1",
      supplierName: "Erom Wholesalers",
      supplierEmail: "sales@erom.co.za",
      supplierFacingReference: "RFQ-CONS-20261012-001",
      internalSourcingReference: "BID-000011-SRC-001",
      subject: "Request for quotation — consumables supply",
      body: "test",
      lineItems: [],
    });
    const result = await executeGmailTransport(job, {
      sendAs: async () => {
        called = true;
        return {
          messageId: "x",
          threadId: "y",
          authenticatedAs: "orisonchemcsd@gmail.com",
        };
      },
    });
    expect(result.status).toBe("REFUSED");
    expect(called).toBe(false);
  });

  it("refuses sender substitution even when allowExecute is set", async () => {
    const job = buildValidatedSourcingJob({
      bidInternalId: "BID-000011",
      companyId: "co1",
      companyLegalName: "ORISON CHEMICALS",
      companyTradingName: "Orison Chemicals",
      companyRegistrationNumber: "2014/277853/07",
      approvedSenderGmail: "orisonchemcsd@gmail.com",
      supplierId: "s1",
      supplierName: "Erom",
      supplierEmail: "sales@erom.co.za",
      supplierFacingReference: "RFQ-CONS-20261012-001",
      internalSourcingReference: "BID-000011-SRC-001",
      subject: "Request for quotation — consumables supply",
      body: "test",
      lineItems: [],
    });
    const result = await executeGmailTransport(
      job,
      {
        sendAs: async () => ({
          messageId: "x",
          threadId: "y",
          authenticatedAs: "smartprocure.ai@gmail.com",
        }),
      },
      { allowExecute: true },
    );
    expect(result.status).toBe("REFUSED");
    expect(result.error).toMatch(/substitution|authenticated as/i);
  });
});
