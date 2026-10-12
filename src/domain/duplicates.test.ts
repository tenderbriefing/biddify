import { describe, expect, it } from "vitest";
import { detectDuplicates } from "./duplicates";

describe("duplicate detection", () => {
  it("detects exact source identity duplicates", () => {
    const matches = detectDuplicates([
      {
        id: "a",
        source: "ETENDERS_OCDS",
        sourceOpportunityId: "ocds-1",
        title: "RFQ A",
        buyer: "Buyer",
        closingAt: new Date("2026-10-16T11:00:00Z"),
      },
      {
        id: "b",
        source: "ETENDERS_OCDS",
        sourceOpportunityId: "ocds-1",
        title: "RFQ A copy",
        buyer: "Buyer",
        closingAt: new Date("2026-10-16T11:00:00Z"),
        selectedCompanyId: "co-2",
      },
    ]);
    expect(matches[0]?.kind).toBe("EXACT_SOURCE");
  });

  it("flags same tender number across companies", () => {
    const matches = detectDuplicates([
      {
        id: "a",
        source: "ETENDERS_OCDS",
        sourceOpportunityId: "ocds-1",
        tenderNumber: "COM133/2026",
        title: "Consumables",
        buyer: "Mbombela",
        closingAt: new Date("2026-10-16T11:00:00Z"),
        selectedCompanyId: "co-a",
      },
      {
        id: "b",
        source: "MANUAL",
        sourceOpportunityId: "manual-1",
        tenderNumber: "COM133/2026",
        title: "Consumables pack",
        buyer: "Mbombela Local Municipality",
        closingAt: new Date("2026-10-16T11:00:00Z"),
        selectedCompanyId: "co-b",
      },
    ]);
    expect(matches.some((m) => m.kind === "SAME_TENDER_NUMBER")).toBe(true);
    expect(
      matches.find((m) => m.kind === "SAME_TENDER_NUMBER")
        ?.sameOpportunityDifferentCompanies,
    ).toBe(true);
  });
});
