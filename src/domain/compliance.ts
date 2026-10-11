export type ComplianceItemState =
  | "NOT_REQUIRED"
  | "MISSING"
  | "AVAILABLE"
  | "EXPIRED"
  | "NEEDS_SIGNATURE"
  | "COMPLETED"
  | "VERIFIED";

export type ComplianceItem = {
  itemKey: string;
  label: string;
  isMandatory: boolean;
  state: ComplianceItemState;
};

export type ComplianceGateResult = {
  submissionReady: boolean;
  blockingItems: ComplianceItem[];
  warnings: ComplianceItem[];
};

const BLOCKING_STATES: ComplianceItemState[] = [
  "MISSING",
  "EXPIRED",
  "NEEDS_SIGNATURE",
];

/**
 * Missing mandatory items block "submission ready".
 */
export function evaluateComplianceGate(
  items: ComplianceItem[],
): ComplianceGateResult {
  const blockingItems = items.filter(
    (item) => item.isMandatory && BLOCKING_STATES.includes(item.state),
  );
  const warnings = items.filter(
    (item) =>
      !item.isMandatory &&
      (item.state === "MISSING" ||
        item.state === "EXPIRED" ||
        item.state === "NEEDS_SIGNATURE"),
  );

  return {
    submissionReady: blockingItems.length === 0,
    blockingItems,
    warnings,
  };
}
