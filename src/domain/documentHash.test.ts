import { describe, expect, it } from "vitest";
import { sha256Text, shouldReprocessDocument } from "./documentHash";

describe("document hash / dedupe", () => {
  it("produces stable hashes", () => {
    expect(sha256Text("abc")).toBe(sha256Text("abc"));
    expect(sha256Text("abc")).not.toBe(sha256Text("abd"));
  });

  it("skips reprocessing when hash unchanged", () => {
    const hash = sha256Text("same-doc");
    expect(shouldReprocessDocument(hash, hash)).toBe(false);
    expect(shouldReprocessDocument(null, hash)).toBe(true);
    expect(shouldReprocessDocument("old", hash)).toBe(true);
  });
});
