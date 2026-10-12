import { describe, expect, it } from "vitest";
import {
  buildSourceIdentity,
  etendersSourceIdentity,
  ETENDERS_OCDS_SOURCE,
} from "./sourceIdentity";

describe("source identity", () => {
  it("builds deterministic source + id key", () => {
    const id = buildSourceIdentity("ETENDERS_OCDS", "ocds-9t57fa-173573");
    expect(id.key).toBe("ETENDERS_OCDS::ocds-9t57fa-173573");
    expect(id.source).toBe(ETENDERS_OCDS_SOURCE);
  });

  it("rejects empty source opportunity id", () => {
    expect(() => buildSourceIdentity("ETENDERS_OCDS", "  ")).toThrow(
      /sourceOpportunityId/,
    );
  });

  it("etenders helper uses OCDS source constant", () => {
    expect(etendersSourceIdentity("ocds-1").source).toBe("ETENDERS_OCDS");
  });
});
