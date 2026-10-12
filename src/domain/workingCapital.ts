import { roundMoney, toNumber } from "./money";

export type WorkingCapitalInput = {
  /** Cash that must be paid to suppliers before customer pays. */
  upfrontSupplierCash: number;
  otherUpfrontCosts?: number;
  /** Expected days until customer payment after delivery/invoice. */
  expectedRecoveryDays: number;
  supplierPaymentTerms: string;
  buyerPaymentTerms: string;
  financingAssumption?: string;
};

export type WorkingCapitalResult = {
  upfrontCashRequired: number;
  expectedRecoveryDays: number;
  supplierPaymentTerms: string;
  buyerPaymentTerms: string;
  financingAssumption: string;
  intensity: "LOW" | "MEDIUM" | "HIGH";
};

export function calculateWorkingCapital(
  input: WorkingCapitalInput,
): WorkingCapitalResult {
  const upfront = roundMoney(
    toNumber(input.upfrontSupplierCash) + toNumber(input.otherUpfrontCosts ?? 0),
  );
  const days = Math.max(0, Math.round(toNumber(input.expectedRecoveryDays)));
  let intensity: WorkingCapitalResult["intensity"] = "LOW";
  if (upfront >= 200_000 || days >= 45) intensity = "HIGH";
  else if (upfront >= 50_000 || days >= 30) intensity = "MEDIUM";

  return {
    upfrontCashRequired: upfront,
    expectedRecoveryDays: days,
    supplierPaymentTerms: input.supplierPaymentTerms,
    buyerPaymentTerms: input.buyerPaymentTerms,
    financingAssumption:
      input.financingAssumption ??
      "Assumes supplier cash paid before customer recovery; no revolving facility modelled.",
    intensity,
  };
}
