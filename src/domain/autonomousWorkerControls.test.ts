import { describe, expect, it } from "vitest";
import {
  CLAIM_TTL_MS,
  MAX_TRANSIENT_RETRIES,
  isRetryableFailure,
  isTerminalState,
  outcomeFromState,
} from "./autonomousStates";

describe("worker failure isolation / retry / idempotency controls", () => {
  it("defines claim TTL and retry cap", () => {
    expect(CLAIM_TTL_MS).toBeGreaterThan(0);
    expect(MAX_TRANSIENT_RETRIES).toBe(2);
  });

  it("classifies transient vs structural failures", () => {
    expect(isRetryableFailure("network timeout")).toBe(true);
    expect(isRetryableFailure("no credible prices")).toBe(false);
  });

  it("maps terminal states to outcomes", () => {
    expect(isTerminalState("AUTO_QUOTED")).toBe(true);
    expect(isTerminalState("PRODUCT_RESEARCH")).toBe(false);
    expect(outcomeFromState("REVIEW_REQUIRED")).toBe("REVIEW_REQUIRED");
    expect(outcomeFromState("NOT_SUPPLY_AND_DELIVER")).toBe("SKIPPED_NOT_SUPPLY");
  });
});
