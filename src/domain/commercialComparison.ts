/**
 * Supplier quotation comparison — never auto-pick cheapest incomplete/unverified quotes.
 */

import type { SpecMatchState } from "./specMatch";
import type { QuoteEvidenceType } from "./quoteEvidence";
import { calculateSplitSourceGoodsCost, recommendOffer } from "./quoteComparison";

export type QuoteFlag =
  | "CHEAPEST_COMPLETE_QUOTE"
  | "CHEAPEST_LINE"
  | "INCOMPLETE_QUOTE"
  | "EXPIRED_QUOTE"
  | "MISSING_ITEM"
  | "SPEC_MISMATCH"
  | "UNVERIFIED_EVIDENCE";

export type QuoteLineOffer = {
  quoteId: string;
  quoteLineId: string;
  supplierId: string;
  supplierName: string;
  unitCost: number | null;
  lineTotal: number | null;
  availability?: string | null;
  brandSku?: string | null;
  matchState: SpecMatchState;
  evidenceType: QuoteEvidenceType;
  verificationState: string;
};

export type BoqComparisonRow = {
  rfqLineItemId: string;
  description: string;
  requiredQty: number;
  unit: string;
  offers: QuoteLineOffer[];
  flags: QuoteFlag[];
  cheapestValidQuoteLineId?: string;
};

export type SupplierQuoteSummary = {
  quoteId: string;
  supplierId: string;
  supplierName: string;
  evidenceType: QuoteEvidenceType;
  verificationState: string;
  subtotal: number | null;
  vatAmount: number | null;
  deliveryCost: number | null;
  deliveryKnown: boolean;
  totalLanded: number | null;
  validUntil: Date | null;
  leadTimeDays: number | null;
  coveredLineIds: string[];
  missingLineIds: string[];
  coveragePercent: number;
  flags: QuoteFlag[];
  isComplete: boolean;
  isExpired: boolean;
  isVerifiedSupplierQuote: boolean;
};

export type SourcingPlanLine = {
  rfqLineItemId: string;
  supplierId: string;
  quoteId: string;
  quoteLineId: string;
  unitCost: number;
  quantity: number;
  lineCost: number;
};

export type SystemSourcingRecommendation = {
  label: "SYSTEM_RECOMMENDATION";
  strategyType: "SINGLE_SUPPLIER" | "SPLIT_AWARD";
  lines: SourcingPlanLine[];
  goodsCost: number;
  deliveryCost: number;
  deliveryKnown: boolean;
  totalLandedEstimate: number | null;
  quoteIds: string[];
  reason: string;
  blockers: string[];
};

function isVerifiedSupplierQuote(
  evidenceType: string,
  verificationState: string,
): boolean {
  return (
    evidenceType === "SUPPLIER_QUOTE" && verificationState === "VERIFIED"
  );
}

export function isQuoteExpired(validUntil: Date | null, now = new Date()): boolean {
  if (!validUntil) return false;
  return validUntil.getTime() < now.getTime();
}

export function buildBoqComparison(
  boq: Array<{
    id: string;
    description: string;
    quantity: number;
    unit: string;
  }>,
  offers: Array<QuoteLineOffer & { rfqLineItemId: string }>,
): BoqComparisonRow[] {
  return boq.map((line) => {
    const lineOffers = offers.filter((o) => o.rfqLineItemId === line.id);
    const flags: QuoteFlag[] = [];
    if (lineOffers.length === 0) flags.push("MISSING_ITEM");

    const valid = lineOffers.filter(
      (o) =>
        o.unitCost != null &&
        isVerifiedSupplierQuote(o.evidenceType, o.verificationState) &&
        o.matchState !== "NON_COMPLIANT" &&
        o.matchState !== "UNKNOWN",
    );
    for (const o of lineOffers) {
      if (!isVerifiedSupplierQuote(o.evidenceType, o.verificationState)) {
        flags.push("UNVERIFIED_EVIDENCE");
      }
      if (o.matchState === "NON_COMPLIANT") flags.push("SPEC_MISMATCH");
    }

    let cheapestValidQuoteLineId: string | undefined;
    if (valid.length) {
      const cheapest = [...valid].sort((a, b) => a.unitCost! - b.unitCost!)[0]!;
      cheapestValidQuoteLineId = cheapest.quoteLineId;
      flags.push("CHEAPEST_LINE");
    }

    return {
      rfqLineItemId: line.id,
      description: line.description,
      requiredQty: line.quantity,
      unit: line.unit,
      offers: lineOffers,
      flags: [...new Set(flags)],
      cheapestValidQuoteLineId,
    };
  });
}

export function summariseSupplierQuotes(input: {
  boqLineIds: string[];
  quotes: Array<{
    quoteId: string;
    supplierId: string;
    supplierName: string;
    evidenceType: QuoteEvidenceType;
    verificationState: string;
    subtotal: number | null;
    vatAmount: number | null;
    deliveryCost: number | null;
    deliveryKnown: boolean;
    validUntil: Date | null;
    leadTimeDays: number | null;
    coveredLineIds: string[];
    isCompleteClaim: boolean;
  }>;
  now?: Date;
}): SupplierQuoteSummary[] {
  const now = input.now ?? new Date();
  const summaries = input.quotes.map((q) => {
    const missing = input.boqLineIds.filter((id) => !q.coveredLineIds.includes(id));
    const coveragePercent =
      input.boqLineIds.length === 0
        ? 0
        : Math.round(
            ((input.boqLineIds.length - missing.length) / input.boqLineIds.length) *
              100,
          );
    const isExpired = isQuoteExpired(q.validUntil, now);
    const isVerified = isVerifiedSupplierQuote(
      q.evidenceType,
      q.verificationState,
    );
    const isComplete =
      missing.length === 0 &&
      q.deliveryKnown &&
      q.subtotal != null &&
      isVerified &&
      !isExpired;
    const flags: QuoteFlag[] = [];
    if (missing.length) flags.push("INCOMPLETE_QUOTE", "MISSING_ITEM");
    if (isExpired) flags.push("EXPIRED_QUOTE");
    if (!isVerified) flags.push("UNVERIFIED_EVIDENCE");

    const totalLanded =
      q.subtotal != null && q.deliveryKnown && q.deliveryCost != null
        ? Math.round((q.subtotal + q.deliveryCost + (q.vatAmount ?? 0) + Number.EPSILON) * 100) /
          100
        : null;

    return {
      quoteId: q.quoteId,
      supplierId: q.supplierId,
      supplierName: q.supplierName,
      evidenceType: q.evidenceType,
      verificationState: q.verificationState,
      subtotal: q.subtotal,
      vatAmount: q.vatAmount,
      deliveryCost: q.deliveryCost,
      deliveryKnown: q.deliveryKnown,
      totalLanded,
      validUntil: q.validUntil,
      leadTimeDays: q.leadTimeDays,
      coveredLineIds: q.coveredLineIds,
      missingLineIds: missing,
      coveragePercent,
      flags,
      isComplete,
      isExpired,
      isVerifiedSupplierQuote: isVerified,
    };
  });

  const complete = summaries
    .filter((s) => s.isComplete && s.totalLanded != null)
    .sort((a, b) => a.totalLanded! - b.totalLanded!);
  if (complete[0]) {
    complete[0].flags.push("CHEAPEST_COMPLETE_QUOTE");
  }
  return summaries;
}

/**
 * Build SYSTEM_RECOMMENDATION for single-supplier or split-award.
 * Only VERIFIED SUPPLIER_QUOTE lines with known compliant prices are eligible.
 */
export function recommendSourcingStrategy(input: {
  boq: Array<{ id: string; quantity: number }>;
  offers: Array<
    QuoteLineOffer & {
      rfqLineItemId: string;
      deliveryCost: number | null;
      deliveryKnown: boolean;
      quoteExpired: boolean;
    }
  >;
}): SystemSourcingRecommendation {
  const blockers: string[] = [];
  const eligible = input.offers.filter(
    (o) =>
      isVerifiedSupplierQuote(o.evidenceType, o.verificationState) &&
      o.unitCost != null &&
      !o.quoteExpired &&
      o.matchState !== "NON_COMPLIANT" &&
      o.matchState !== "UNKNOWN",
  );

  if (eligible.length === 0) {
    return {
      label: "SYSTEM_RECOMMENDATION",
      strategyType: "SINGLE_SUPPLIER",
      lines: [],
      goodsCost: 0,
      deliveryCost: 0,
      deliveryKnown: false,
      totalLandedEstimate: null,
      quoteIds: [],
      reason: "No verified compliant SUPPLIER_QUOTE lines available",
      blockers: ["No verified supplier quote lines"],
    };
  }

  // Prefer complete single-supplier covering all BOQ lines
  const bySupplier = new Map<string, typeof eligible>();
  for (const o of eligible) {
    const list = bySupplier.get(o.supplierId) ?? [];
    list.push(o);
    bySupplier.set(o.supplierId, list);
  }

  const completeSingles: Array<{
    supplierId: string;
    lines: SourcingPlanLine[];
    goods: number;
    delivery: number;
    deliveryKnown: boolean;
    quoteIds: string[];
  }> = [];

  for (const [supplierId, offs] of bySupplier) {
    const lines: SourcingPlanLine[] = [];
    let ok = true;
    for (const boq of input.boq) {
      const candidates = offs.filter((o) => o.rfqLineItemId === boq.id);
      const rec = recommendOffer(
        candidates.map((c) => ({
          supplierId: c.supplierId,
          supplierName: c.supplierName,
          unitCost: c.unitCost,
          lineTotal: c.lineTotal,
          deliveryCost: c.deliveryCost,
          deliveryKnown: c.deliveryKnown,
          leadTimeDays: null,
          matchState: c.matchState,
          evidenceType: c.evidenceType,
          quoteLineId: c.quoteLineId,
        })),
      );
      const best = candidates.find((c) => c.supplierId === rec.supplierId);
      if (!best || best.unitCost == null) {
        ok = false;
        break;
      }
      lines.push({
        rfqLineItemId: boq.id,
        supplierId,
        quoteId: best.quoteId,
        quoteLineId: best.quoteLineId,
        unitCost: best.unitCost,
        quantity: boq.quantity,
        lineCost: Math.round(boq.quantity * best.unitCost * 100) / 100,
      });
    }
    if (ok && lines.length === input.boq.length) {
      const goods = calculateSplitSourceGoodsCost(
        lines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost })),
      )!;
      const sample = offs[0]!;
      completeSingles.push({
        supplierId,
        lines,
        goods,
        delivery: sample.deliveryKnown ? (sample.deliveryCost ?? 0) : 0,
        deliveryKnown: sample.deliveryKnown,
        quoteIds: [...new Set(lines.map((l) => l.quoteId))],
      });
    }
  }

  if (completeSingles.length) {
    completeSingles.sort((a, b) => {
      const aTotal = a.deliveryKnown ? a.goods + a.delivery : a.goods;
      const bTotal = b.deliveryKnown ? b.goods + b.delivery : b.goods;
      return aTotal - bTotal;
    });
    const best = completeSingles[0]!;
    if (!best.deliveryKnown) {
      blockers.push("Delivery cost UNKNOWN on recommended single-supplier quote");
    }
    return {
      label: "SYSTEM_RECOMMENDATION",
      strategyType: "SINGLE_SUPPLIER",
      lines: best.lines,
      goodsCost: best.goods,
      deliveryCost: best.delivery,
      deliveryKnown: best.deliveryKnown,
      totalLandedEstimate: best.deliveryKnown
        ? Math.round((best.goods + best.delivery) * 100) / 100
        : null,
      quoteIds: best.quoteIds,
      reason: `Complete single-supplier coverage via verified quotes (supplier ${best.supplierId})`,
      blockers,
    };
  }

  // Split award: best verified line per BOQ item
  const splitLines: SourcingPlanLine[] = [];
  for (const boq of input.boq) {
    const candidates = eligible.filter((o) => o.rfqLineItemId === boq.id);
    const rec = recommendOffer(
      candidates.map((c) => ({
        supplierId: c.supplierId,
        supplierName: c.supplierName,
        unitCost: c.unitCost,
        lineTotal: c.lineTotal,
        deliveryCost: c.deliveryCost,
        deliveryKnown: c.deliveryKnown,
        leadTimeDays: null,
        matchState: c.matchState,
        evidenceType: c.evidenceType,
        quoteLineId: c.quoteLineId,
      })),
    );
    const best = candidates.find((c) => c.supplierId === rec.supplierId);
    if (!best || best.unitCost == null) {
      blockers.push(`No verified offer for BOQ line ${boq.id}`);
      continue;
    }
    splitLines.push({
      rfqLineItemId: boq.id,
      supplierId: best.supplierId,
      quoteId: best.quoteId,
      quoteLineId: best.quoteLineId,
      unitCost: best.unitCost,
      quantity: boq.quantity,
      lineCost: Math.round(boq.quantity * best.unitCost * 100) / 100,
    });
  }

  const goods = calculateSplitSourceGoodsCost(
    splitLines.map((l) => ({ quantity: l.quantity, unitCost: l.unitCost })),
  );
  if (goods == null || splitLines.length !== input.boq.length) {
    blockers.push("Split award incomplete — missing verified lines");
    return {
      label: "SYSTEM_RECOMMENDATION",
      strategyType: "SPLIT_AWARD",
      lines: splitLines,
      goodsCost: goods ?? 0,
      deliveryCost: 0,
      deliveryKnown: false,
      totalLandedEstimate: null,
      quoteIds: [...new Set(splitLines.map((l) => l.quoteId))],
      reason: "Partial split-award recommendation only",
      blockers,
    };
  }

  // Delivery: sum unique quotes' delivery when known; else unknown
  const quoteMeta = new Map<string, { deliveryKnown: boolean; deliveryCost: number | null }>();
  for (const o of eligible) {
    quoteMeta.set(o.quoteId, {
      deliveryKnown: o.deliveryKnown,
      deliveryCost: o.deliveryCost,
    });
  }
  let deliveryKnown = true;
  let deliveryCost = 0;
  for (const qid of new Set(splitLines.map((l) => l.quoteId))) {
    const m = quoteMeta.get(qid);
    if (!m?.deliveryKnown || m.deliveryCost == null) {
      deliveryKnown = false;
    } else {
      deliveryCost += m.deliveryCost;
    }
  }
  if (!deliveryKnown) {
    blockers.push("One or more split quotes have UNKNOWN delivery");
    deliveryCost = 0;
  }

  return {
    label: "SYSTEM_RECOMMENDATION",
    strategyType: "SPLIT_AWARD",
    lines: splitLines,
    goodsCost: goods,
    deliveryCost: Math.round(deliveryCost * 100) / 100,
    deliveryKnown,
    totalLandedEstimate: deliveryKnown
      ? Math.round((goods + deliveryCost) * 100) / 100
      : null,
    quoteIds: [...new Set(splitLines.map((l) => l.quoteId))],
    reason: "No complete single-supplier verified quote — split-award recommendation",
    blockers,
  };
}
