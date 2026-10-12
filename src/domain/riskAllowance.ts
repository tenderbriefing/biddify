/**
 * Explicit risk allowances — never a silent markup substitute.
 */

import { roundMoney, toNumber } from "./money";

export const RISK_ALLOWANCE_TYPES = [
  "DELIVERY_ALLOWANCE",
  "PRICE_VOLATILITY_ALLOWANCE",
  "PACKAGING_ALLOWANCE",
] as const;

export type RiskAllowanceType = (typeof RISK_ALLOWANCE_TYPES)[number];

export type RiskAllowanceLine = {
  type: RiskAllowanceType;
  amount: number;
  reason: string;
  policyRef: string;
};

export type RiskAllowanceResult = {
  lines: RiskAllowanceLine[];
  total: number;
};

export function buildRiskAllowances(input: {
  deliveryAllowance?: number;
  deliveryReason?: string;
  volatilityAllowance?: number;
  packagingAllowance?: number;
}): RiskAllowanceResult {
  const lines: RiskAllowanceLine[] = [];

  if (input.deliveryAllowance && input.deliveryAllowance > 0) {
    lines.push({
      type: "DELIVERY_ALLOWANCE",
      amount: roundMoney(toNumber(input.deliveryAllowance)),
      reason: input.deliveryReason ?? "Configured low-materiality delivery allowance",
      policyRef: "RESEARCH_POLICY.delivery.lowMaterialityAllowance*",
    });
  }

  if (input.volatilityAllowance && input.volatilityAllowance > 0) {
    lines.push({
      type: "PRICE_VOLATILITY_ALLOWANCE",
      amount: roundMoney(toNumber(input.volatilityAllowance)),
      reason: "Configured price volatility allowance",
      policyRef: "founder.policy.priceVolatility",
    });
  }

  if (input.packagingAllowance && input.packagingAllowance > 0) {
    lines.push({
      type: "PACKAGING_ALLOWANCE",
      amount: roundMoney(toNumber(input.packagingAllowance)),
      reason: "Configured packaging allowance",
      policyRef: "founder.policy.packaging",
    });
  }

  const total = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, total };
}
