import { describe, expect, it } from "vitest";
import { evaluateComplianceGate } from "./compliance";

describe("compliance gate", () => {
  it("blocks submission when mandatory items are missing", () => {
    const result = evaluateComplianceGate([
      {
        itemKey: "csd",
        label: "CSD",
        isMandatory: true,
        state: "VERIFIED",
      },
      {
        itemKey: "quotation",
        label: "Signed quotation",
        isMandatory: true,
        state: "MISSING",
      },
    ]);
    expect(result.submissionReady).toBe(false);
    expect(result.blockingItems).toHaveLength(1);
  });

  it("allows submission when mandatory items are complete", () => {
    const result = evaluateComplianceGate([
      {
        itemKey: "csd",
        label: "CSD",
        isMandatory: true,
        state: "VERIFIED",
      },
      {
        itemKey: "bee",
        label: "B-BBEE",
        isMandatory: false,
        state: "MISSING",
      },
    ]);
    expect(result.submissionReady).toBe(true);
    expect(result.warnings).toHaveLength(1);
  });
});
