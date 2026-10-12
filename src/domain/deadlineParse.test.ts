import { describe, expect, it } from "vitest";
import { formatClosingDisplay, parseClosingDeadline } from "./deadlineParse";

describe("deadline parsing", () => {
  it("flags date-only closing as time UNKNOWN (never invents 23:59)", () => {
    const parsed = parseClosingDeadline("2026-10-15");
    expect(parsed).not.toBeNull();
    expect(parsed!.closingTimeKnown).toBe(false);
    expect(parsed!.warning).toMatch(/UNKNOWN/);
    // Stored as 00:00 SAST (= 22:00 previous day UTC), not 23:59
    const hours = parsed!.closingAt.getUTCHours();
    const minutes = parsed!.closingAt.getUTCMinutes();
    expect(minutes).toBe(0);
    expect(hours === 22 || hours === 0).toBe(true);
  });

  it("keeps ISO timestamps as time known", () => {
    const parsed = parseClosingDeadline("2026-10-16T11:00:00Z");
    expect(parsed!.closingTimeKnown).toBe(true);
    expect(parsed!.closingAt.toISOString()).toBe("2026-10-16T11:00:00.000Z");
  });

  it("formats unknown time explicitly", () => {
    const parsed = parseClosingDeadline("2026-10-15")!;
    expect(formatClosingDisplay(parsed.closingAt, false)).toMatch(/UNKNOWN/);
  });
});
