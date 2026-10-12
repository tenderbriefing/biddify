import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, redactToken } from "./tokenVault";

describe("token vault", () => {
  it("round-trips encrypted secrets", () => {
    process.env.AUTH_SECRET = "test-secret-at-least-16";
    const enc = encryptSecret("oauth-token-value");
    expect(enc).not.toContain("oauth-token-value");
    expect(decryptSecret(enc)).toBe("oauth-token-value");
  });

  it("redacts tokens for display", () => {
    expect(redactToken("abcdefghij")).toMatch(/…/);
  });
});
