import { describe, expect, it } from "vitest";
import { createNoBidDecision } from "./nobid";

describe("no-bid workflow", () => {
  it("records NO BID with category and notes", () => {
    const decision = createNoBidDecision({
      currentStatus: "REVIEW",
      category: "BRIEFING_MISSED",
      notes: "Compulsory briefing 3 days ago; no attendance evidence",
      decidedBy: "OPERATOR",
    });
    expect(decision.ok).toBe(true);
    expect(decision.status).toBe("NO_BID");
    expect(decision.reason).toMatch(/BRIEFING MISSED/);
  });

  it("requires notes for OTHER category", () => {
    const decision = createNoBidDecision({
      currentStatus: "NEW",
      category: "OTHER",
      decidedBy: "OPERATOR",
    });
    expect(decision.ok).toBe(false);
  });

  it("rejects invalid status transition into NO_BID", () => {
    const decision = createNoBidDecision({
      currentStatus: "SUBMITTED",
      category: "DEADLINE",
      notes: "too late",
      decidedBy: "OPERATOR",
    });
    expect(decision.ok).toBe(false);
  });
});
