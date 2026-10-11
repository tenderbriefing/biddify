import { describe, expect, it } from "vitest";
import {
  assertPermission,
  canExecuteSubmission,
  canFounderApprove,
  hasPermission,
} from "./permissions";

describe("RBAC permissions", () => {
  it("grants Founder approval only to FOUNDER", () => {
    expect(canFounderApprove("FOUNDER")).toBe(true);
    expect(canFounderApprove("ADMIN")).toBe(false);
    expect(canFounderApprove("BID_MANAGER")).toBe(false);
    expect(canFounderApprove("REVIEWER")).toBe(false);
    expect(canFounderApprove("READ_ONLY")).toBe(false);
  });

  it("restricts submission execute to FOUNDER", () => {
    expect(canExecuteSubmission("FOUNDER")).toBe(true);
    expect(canExecuteSubmission("ADMIN")).toBe(false);
  });

  it("allows READ_ONLY to read but not write RFQs", () => {
    expect(hasPermission("READ_ONLY", "rfq:read")).toBe(true);
    expect(hasPermission("READ_ONLY", "rfq:write")).toBe(false);
  });

  it("assertPermission throws when denied", () => {
    expect(() => assertPermission("READ_ONLY", "approval:founder")).toThrow(
      /lacks permission/,
    );
  });
});
