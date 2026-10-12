import { describe, expect, it } from "vitest";
import { buildComplianceChecklist } from "./complianceChecklist";
import { evaluateComplianceGate } from "./compliance";

describe("compliance checklist builder", () => {
  it("never invents CSD as available without vault evidence", () => {
    const items = buildComplianceChecklist({
      rfqInternalId: "BID-000011",
      requirements: [
        {
          requirementType: "CSD",
          description: "Must be on CSD",
          isMandatory: true,
          evidenceSource: "RFQ PDF",
        },
      ],
      companyDocs: [],
      hasPricingScenario: true,
      hasLineItems: true,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
    });
    const csd = items.find((i) => i.itemKey === "csd");
    expect(csd?.state).toBe("MISSING");
    expect(csd?.evidenceSource).toBeTruthy();
  });

  it("marks vault CSD available and blocks mandatory MBD forms", () => {
    const items = buildComplianceChecklist({
      rfqInternalId: "BID-000011",
      requirements: [
        {
          requirementType: "MBD_FORMS",
          description: "Complete MBD forms",
          isMandatory: true,
          evidenceSource: "RFQ PDF",
        },
      ],
      companyDocs: [
        {
          documentType: "CSD",
          verificationState: "AVAILABLE",
          title: "CSD Report",
        },
        {
          documentType: "TAX",
          verificationState: "AVAILABLE",
          title: "Tax letter",
        },
        {
          documentType: "BBBEE",
          verificationState: "AVAILABLE",
          title: "BEE 2025",
        },
        {
          documentType: "CIPC",
          verificationState: "AVAILABLE",
          title: "COR14.3",
        },
      ],
      hasPricingScenario: true,
      hasLineItems: true,
      briefingCompulsory: false,
      briefingCompulsoryKnown: true,
    });
    expect(items.find((i) => i.itemKey === "csd")?.state).toBe("AVAILABLE");
    const gate = evaluateComplianceGate(items);
    expect(gate.submissionReady).toBe(false);
    expect(
      gate.blockingItems.some((b) => /MBD|Founder|signature/i.test(b.label)),
    ).toBe(true);
  });
});
