export type ReadinessItem = {
  key: string;
  label: string;
  state: "READY" | "ACTION_REQUIRED" | "NOT_APPLICABLE" | "UNKNOWN";
  detail?: string;
};

export type CompanyReadinessInput = {
  hasCipc: boolean;
  hasCsd: boolean;
  taxCompliant: boolean | "UNKNOWN";
  hasBee: boolean | "NOT_APPLICABLE";
  hasBankConfirmation: boolean;
  vatStatusKnown: boolean;
  requiredLicenceMissing?: boolean;
};

export type CompanyReadinessResult = {
  overall: "READY" | "ACTION_REQUIRED" | "UNKNOWN";
  items: ReadinessItem[];
  blockers: string[];
};

export function calculateCompanyReadiness(
  input: CompanyReadinessInput,
): CompanyReadinessResult {
  const items: ReadinessItem[] = [
    {
      key: "CIPC",
      label: "Company registration",
      state: input.hasCipc ? "READY" : "ACTION_REQUIRED",
      detail: input.hasCipc ? "CIPC evidence on file" : "Missing CIPC / COR14.3",
    },
    {
      key: "CSD",
      label: "CSD registration",
      state: input.hasCsd ? "READY" : "ACTION_REQUIRED",
      detail: input.hasCsd ? "CSD report on file" : "Missing CSD report",
    },
    {
      key: "TAX",
      label: "Tax compliance",
      state:
        input.taxCompliant === true
          ? "READY"
          : input.taxCompliant === false
            ? "ACTION_REQUIRED"
            : "UNKNOWN",
      detail:
        input.taxCompliant === true
          ? "Tax PIN / compliance evidence on file"
          : "Tax status unknown or not ready",
    },
    {
      key: "BBBEE",
      label: "B-BBEE",
      state:
        input.hasBee === "NOT_APPLICABLE"
          ? "NOT_APPLICABLE"
          : input.hasBee
            ? "READY"
            : "ACTION_REQUIRED",
    },
    {
      key: "BANK",
      label: "Bank confirmation",
      state: input.hasBankConfirmation ? "READY" : "ACTION_REQUIRED",
    },
    {
      key: "VAT",
      label: "VAT status known",
      state: input.vatStatusKnown ? "READY" : "ACTION_REQUIRED",
      detail: input.vatStatusKnown
        ? "VAT status verified from evidence"
        : "VAT status UNKNOWN — never infer",
    },
    {
      key: "LICENCE",
      label: "Required licence",
      state: input.requiredLicenceMissing
        ? "ACTION_REQUIRED"
        : "NOT_APPLICABLE",
    },
  ];

  const blockers = items
    .filter((i) => i.state === "ACTION_REQUIRED")
    .map((i) => `${i.label}: ${i.detail ?? "ACTION REQUIRED"}`);

  const unknown = items.some((i) => i.state === "UNKNOWN");
  const overall =
    blockers.length > 0 ? "ACTION_REQUIRED" : unknown ? "UNKNOWN" : "READY";

  return { overall, items, blockers };
}
