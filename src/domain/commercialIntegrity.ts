/**
 * Commercial integrity gate — must pass before AUTO_QUOTED / commercially ready quote.
 */

import type { QuantityReconciliation } from "./quantityReconciliation";
import type { VarianceResult } from "./priceVariancePolicy";
import type { DeliveryMaterialityV2 } from "./deliveryMaterialityV2";
import type { RfqCostWaterfall } from "./costWaterfall";

export type IntegrityLine = {
  lineNumber: number;
  material: boolean;
  reconciliation: QuantityReconciliation | null;
  priceBasisKnown: boolean;
  packKnownWhereRelevant: boolean;
  unitMismatch: boolean;
  specSelectable: boolean;
};

export type IntegrityInput = {
  lines: IntegrityLine[];
  variance: VarianceResult | null;
  delivery: DeliveryMaterialityV2 | null;
  waterfall: RfqCostWaterfall | null;
  vatAcceptable: boolean;
};

export type IntegrityResult = {
  passed: boolean;
  failures: string[];
  quotationCommerciallyReady: boolean;
};

export function evaluateCommercialIntegrity(
  input: IntegrityInput,
): IntegrityResult {
  const failures: string[] = [];

  for (const line of input.lines) {
    if (!line.material) continue;
    if (!line.reconciliation?.firm) {
      failures.push(
        `Line ${line.lineNumber}: quantity not reconciled (firm=${Boolean(line.reconciliation?.firm)})`,
      );
    }
    if (!line.priceBasisKnown) {
      failures.push(`Line ${line.lineNumber}: price basis unknown`);
    }
    if (!line.packKnownWhereRelevant) {
      failures.push(`Line ${line.lineNumber}: pack size unresolved where relevant`);
    }
    if (line.unitMismatch) {
      failures.push(`Line ${line.lineNumber}: unresolved unit mismatch`);
    }
    if (!line.specSelectable) {
      failures.push(`Line ${line.lineNumber}: specification not auto-selectable`);
    }
  }

  if (input.variance?.blocksAutoQuoted) {
    failures.push(
      `Unexplained extreme price variance (${input.variance.band})`,
    );
  }

  if (!input.vatAcceptable) {
    failures.push("VAT treatment not acceptable for comparison/acquisition");
  }

  if (input.delivery?.blocksAutoQuoted) {
    failures.push(`Delivery economics: ${input.delivery.class}`);
  }

  if (input.waterfall && !input.waterfall.invariantsPassed) {
    failures.push(
      `Cost waterfall invariants failed: ${input.waterfall.invariantFailures.join("; ")}`,
    );
  }

  const passed = failures.length === 0;
  return {
    passed,
    failures,
    quotationCommerciallyReady: passed,
  };
}
