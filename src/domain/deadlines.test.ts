import { describe, expect, it } from "vitest";
import { canSubmit, evaluateDeadline } from "./deadlines";

describe("deadline engine", () => {
  const closing = new Date("2026-10-12T11:00:00+02:00");

  it("marks CLOSED when past deadline", () => {
    const view = evaluateDeadline(
      closing,
      new Date("2026-10-12T11:00:01+02:00"),
    );
    expect(view.isClosed).toBe(true);
    expect(view.warning).toBe("CLOSED");
  });

  it("emits 24h warning inside one day", () => {
    const view = evaluateDeadline(
      closing,
      new Date("2026-10-11T12:00:00+02:00"),
    );
    expect(view.warning).toBe("24h");
    expect(view.isClosed).toBe(false);
  });

  it("blocks late submission without Founder override", () => {
    const denied = canSubmit(
      closing,
      new Date("2026-10-12T12:00:00+02:00"),
      false,
    );
    expect(denied.allowed).toBe(false);

    const allowed = canSubmit(
      closing,
      new Date("2026-10-12T12:00:00+02:00"),
      true,
    );
    expect(allowed.allowed).toBe(true);
  });

  it("allows submission before deadline", () => {
    const result = canSubmit(
      closing,
      new Date("2026-10-12T10:59:00+02:00"),
    );
    expect(result.allowed).toBe(true);
  });
});
