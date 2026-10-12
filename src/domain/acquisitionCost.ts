import { roundMoney, toNumber } from "./money";

/**
 * Acquisition cost for bidding company.
 *
 * If the bidding company is NOT VAT registered, supplier VAT charged on purchases
 * cannot be reclaimed and forms part of true goods cost.
 *
 * If the company IS VAT registered and supplier price is VAT-inclusive,
 * recoverable input VAT is separated from net goods cost (simplified model).
 */

export type AcquisitionInput = {
  /** Supplier goods amount as quoted. */
  supplierGoodsAmount: number;
  /** Whether supplier amount includes VAT. Null = UNKNOWN — do not invent. */
  supplierVatIncluded: boolean | null;
  vatRatePercent?: number;
  biddingCompanyVatRegistered: boolean;
};

export type AcquisitionResult = {
  netGoodsCost: number;
  /** Irrecoverable input VAT included in landed cost for non-VAT companies. */
  irrecoverableInputVat: number;
  recoverableInputVat: number;
  acquisitionCost: number;
  vatTreatmentKnown: boolean;
  notes: string[];
};

export function calculateAcquisitionCost(
  input: AcquisitionInput,
): AcquisitionResult {
  const amount = roundMoney(toNumber(input.supplierGoodsAmount));
  const rate = toNumber(input.vatRatePercent ?? 15);
  const notes: string[] = [];

  if (input.supplierVatIncluded === null) {
    notes.push(
      "Supplier VAT treatment UNKNOWN — acquisition uses quoted amount as-is without inventing VAT split",
    );
    return {
      netGoodsCost: amount,
      irrecoverableInputVat: 0,
      recoverableInputVat: 0,
      acquisitionCost: amount,
      vatTreatmentKnown: false,
      notes,
    };
  }

  if (!input.supplierVatIncluded) {
    notes.push("Supplier quote exclusive of VAT");
    if (!input.biddingCompanyVatRegistered) {
      // Ex-VAT quote: non-VAT company still pays VAT on top when invoiced — unknown unless stated.
      notes.push(
        "Bidding company not VAT registered — if supplier later charges VAT, it becomes irrecoverable cost (not invented here)",
      );
    }
    return {
      netGoodsCost: amount,
      irrecoverableInputVat: 0,
      recoverableInputVat: 0,
      acquisitionCost: amount,
      vatTreatmentKnown: true,
      notes,
    };
  }

  // VAT-inclusive supplier amount
  const net = roundMoney(amount / (1 + rate / 100));
  const vat = roundMoney(amount - net);

  if (input.biddingCompanyVatRegistered) {
    notes.push(
      "VAT-registered buyer — input VAT treated as recoverable; net goods enter landed cost",
    );
    return {
      netGoodsCost: net,
      irrecoverableInputVat: 0,
      recoverableInputVat: vat,
      acquisitionCost: net,
      vatTreatmentKnown: true,
      notes,
    };
  }

  notes.push(
    "Non-VAT-registered buyer — supplier VAT-inclusive price fully absorbed into acquisition cost",
  );
  return {
    netGoodsCost: net,
    irrecoverableInputVat: vat,
    recoverableInputVat: 0,
    acquisitionCost: amount,
    vatTreatmentKnown: true,
    notes,
  };
}
