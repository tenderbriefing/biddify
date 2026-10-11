import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./status";

describe("pipeline status machine", () => {
  it("rejects NEW → SUBMITTED", () => {
    const result = canTransition("NEW", "SUBMITTED");
    expect(result.ok).toBe(false);
  });

  it("allows NEW → REVIEW → QUALIFIED", () => {
    expect(canTransition("NEW", "REVIEW").ok).toBe(true);
    expect(canTransition("REVIEW", "QUALIFIED").ok).toBe(true);
  });

  it("requires Founder approval before SUBMISSION_AUTHORISED", () => {
    const denied = canTransition("APPROVED", "SUBMISSION_AUTHORISED", {
      hasValidFounderApproval: false,
    });
    expect(denied.ok).toBe(false);

    const allowed = canTransition("APPROVED", "SUBMISSION_AUTHORISED", {
      hasValidFounderApproval: true,
    });
    expect(allowed.ok).toBe(true);
  });

  it("blocks submission when approval was invalidated", () => {
    const result = canTransition("SUBMISSION_AUTHORISED", "SUBMITTED", {
      hasValidFounderApproval: true,
      approvalInvalidated: true,
    });
    expect(result.ok).toBe(false);
  });

  it("allows SUBMITTED only from SUBMISSION_AUTHORISED with valid approval", () => {
    expect(
      canTransition("APPROVED", "SUBMITTED", {
        hasValidFounderApproval: true,
      }).ok,
    ).toBe(false);

    expect(
      canTransition("SUBMISSION_AUTHORISED", "SUBMITTED", {
        hasValidFounderApproval: true,
      }).ok,
    ).toBe(true);
  });

  it("assertTransition throws on invalid path", () => {
    expect(() => assertTransition("NEW", "SUBMITTED")).toThrow(
      /Invalid transition/,
    );
  });
});
