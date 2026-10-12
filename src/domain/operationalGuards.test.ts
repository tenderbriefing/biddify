import { describe, expect, it } from "vitest";
import {
  assertCompanyGmailMapping,
  assertGovernmentSubmissionFirewall,
  evaluateOutboundGuards,
  isValidPublishedEmail,
} from "./operationalGuards";

const base = {
  company: {
    id: "co1",
    legalName: "ORISON CHEMICALS",
    tradingName: "Orison Chemicals",
    registrationNumber: "2014/277853/07",
    isDemo: false,
    dataMode: "OPERATIONAL" as const,
    outboundSourcingEnabled: true,
    authorisedSourcingSignatoryName: "Ops User",
    authorisedSourcingSignatoryEmail: "orisonchemcsd@gmail.com",
    authorisedSourcingSignatoryConfirmedAt: new Date("2026-10-12"),
    approvedSourcingMailbox: "orisonchemcsd@gmail.com",
  },
  gmail: {
    companyId: "co1",
    emailAddress: "orisonchemcsd@gmail.com",
    sendingEnabled: true,
    connectionStatus: "CONNECTED",
  },
  approvedSenderGmail: "orisonchemcsd@gmail.com",
  rfq: {
    isDemo: false,
    dataMode: "OPERATIONAL" as const,
    isRealSource: true,
  },
  supplier: {
    isDemo: false,
    dataMode: "OPERATIONAL" as const,
    email: "sales@real-supplier.co.za",
    emailVerified: true,
    suppressionReason: null,
  },
  globalOutboundPaused: false,
  outboundMode: "AUTONOMOUS" as const,
  workflowContext: "SUPPLIER_SOURCING" as const,
};

describe("operational outbound guards", () => {
  it("blocks DEMO company from sending", () => {
    const result = evaluateOutboundGuards({
      ...base,
      company: { ...base.company, isDemo: true, dataMode: "TEST" },
    });
    expect(result.allowed).toBe(false);
    expect(result.blockers.some((b) => /DEMO/i.test(b))).toBe(true);
  });

  it("requires company-Gmail mapping", () => {
    expect(
      assertCompanyGmailMapping({ companyId: "co1", gmailCompanyId: null })
        .allowed,
    ).toBe(false);
    expect(
      assertCompanyGmailMapping({ companyId: "co1", gmailCompanyId: "co2" })
        .allowed,
    ).toBe(false);
    expect(
      assertCompanyGmailMapping({ companyId: "co1", gmailCompanyId: "co1" })
        .allowed,
    ).toBe(true);
  });

  it("blocks wrong-company sender", () => {
    const result = evaluateOutboundGuards({
      ...base,
      gmail: { ...base.gmail, companyId: "other" },
    });
    expect(result.allowed).toBe(false);
  });

  it("enforces global kill switch", () => {
    const result = evaluateOutboundGuards({
      ...base,
      globalOutboundPaused: true,
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks suppressed suppliers", () => {
    const result = evaluateOutboundGuards({
      ...base,
      supplier: {
        ...base.supplier,
        suppressionReason: "DO_NOT_CONTACT",
      },
    });
    expect(result.allowed).toBe(false);
  });

  it("blocks government submission firewall", () => {
    expect(
      assertGovernmentSubmissionFirewall("GOVERNMENT_BID_SUBMIT").allowed,
    ).toBe(false);
    const result = evaluateOutboundGuards({
      ...base,
      workflowContext: "GOVERNMENT_BID_SUBMIT",
    });
    expect(result.allowed).toBe(false);
  });

  it("requires Founder approval in certification mode", () => {
    const result = evaluateOutboundGuards({
      ...base,
      outboundMode: "CERTIFICATION",
      isCertificationBatch: true,
      founderApprovedCertification: false,
    });
    expect(result.allowed).toBe(false);
  });

  it("allows autonomous send when all controls pass", () => {
    const result = evaluateOutboundGuards(base);
    expect(result.allowed).toBe(true);
  });

  it("blocks SmartProcure / sibling company Gmail even when authenticated", () => {
    const result = evaluateOutboundGuards({
      ...base,
      gmail: {
        ...base.gmail,
        emailAddress: "smartprocure.ai@gmail.com",
      },
      approvedSenderGmail: "smartprocure.ai@gmail.com",
    });
    expect(result.allowed).toBe(false);
    expect(result.blockers.some((b) => /MAILBOX|FORBIDDEN/i.test(b))).toBe(
      true,
    );
  });

  it("blocks missing approved signatory", () => {
    const result = evaluateOutboundGuards({
      ...base,
      company: {
        ...base.company,
        authorisedSourcingSignatoryName: null,
        authorisedSourcingSignatoryConfirmedAt: null,
      },
    });
    expect(result.allowed).toBe(false);
    expect(
      result.blockers.some((b) => /BLOCKED_NO_APPROVED_SIGNATORY/.test(b)),
    ).toBe(true);
  });

  it("rejects invented/placeholder emails", () => {
    expect(isValidPublishedEmail("quotes@makro.example.invalid")).toBe(false);
    expect(isValidPublishedEmail("sales@demo.local")).toBe(false);
    expect(isValidPublishedEmail("trade@makro.co.za")).toBe(true);
  });
});
