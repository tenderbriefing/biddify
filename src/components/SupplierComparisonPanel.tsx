import {
  confirmSourcingStrategyAction,
  refreshPricingFromQuotesAction,
} from "@/lib/quotes/actions";
import { formatZar } from "@/lib/format";
import type { BoqComparisonRow, SupplierQuoteSummary, SystemSourcingRecommendation } from "@/domain/commercialComparison";

export function SupplierComparisonPanel({
  rfqId,
  rows,
  summaries,
  recommendation,
  strategyConfirmed,
  pricingBasis,
}: {
  rfqId: string;
  rows: BoqComparisonRow[];
  summaries: SupplierQuoteSummary[];
  recommendation: SystemSourcingRecommendation;
  strategyConfirmed: boolean;
  pricingBasis: string;
}) {
  return (
    <div className="space-y-4">
      <div className="panel overflow-x-auto">
        <div className="panel-header">Line-by-line comparison</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>BOQ item</th>
              <th>Qty</th>
              <th>Supplier</th>
              <th>Unit cost</th>
              <th>Line cost</th>
              <th>Brand/SKU</th>
              <th>Match</th>
              <th>Evidence</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.offers.length === 0 ? (
                <tr key={row.rfqLineItemId}>
                  <td>{row.description}</td>
                  <td className="mono">
                    {row.requiredQty} {row.unit}
                  </td>
                  <td colSpan={6} className="muted">
                    No offers
                  </td>
                  <td>
                    {row.flags.map((f) => (
                      <span key={f} className="badge badge-red mr-1">
                        {f}
                      </span>
                    ))}
                  </td>
                </tr>
              ) : (
                row.offers.map((o, idx) => (
                  <tr key={`${row.rfqLineItemId}-${o.quoteLineId}`}>
                    {idx === 0 && (
                      <>
                        <td rowSpan={row.offers.length}>{row.description}</td>
                        <td rowSpan={row.offers.length} className="mono">
                          {row.requiredQty} {row.unit}
                        </td>
                      </>
                    )}
                    <td className="text-xs">{o.supplierName}</td>
                    <td className="mono">
                      {o.unitCost != null ? formatZar(o.unitCost) : "UNKNOWN"}
                    </td>
                    <td className="mono">
                      {o.lineTotal != null ? formatZar(o.lineTotal) : "UNKNOWN"}
                    </td>
                    <td className="text-xs">{o.brandSku ?? "—"}</td>
                    <td>
                      <span className="badge badge-slate">{o.matchState}</span>
                    </td>
                    <td className="text-xs">
                      {o.evidenceType}
                      <div className="muted">{o.verificationState}</div>
                    </td>
                    {idx === 0 && (
                      <td rowSpan={row.offers.length}>
                        {row.flags.map((f) => (
                          <span
                            key={f}
                            className={`badge mr-1 ${
                              f === "CHEAPEST_LINE" ? "badge-green" : "badge-amber"
                            }`}
                          >
                            {f}
                          </span>
                        ))}
                      </td>
                    )}
                  </tr>
                ))
              ),
            )}
          </tbody>
        </table>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">Supplier totals</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Coverage</th>
              <th>Subtotal</th>
              <th>VAT</th>
              <th>Delivery</th>
              <th>Landed</th>
              <th>Lead time</th>
              <th>Validity</th>
              <th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => (
              <tr key={s.quoteId}>
                <td>
                  <div className="font-medium">{s.supplierName}</div>
                  <div className="muted text-xs">
                    {s.evidenceType} · {s.verificationState}
                  </div>
                </td>
                <td className="mono">{s.coveragePercent}%</td>
                <td className="mono">
                  {s.subtotal != null ? formatZar(s.subtotal) : "UNKNOWN"}
                </td>
                <td className="mono">
                  {s.vatAmount != null ? formatZar(s.vatAmount) : "—"}
                </td>
                <td className="mono">
                  {s.deliveryKnown && s.deliveryCost != null
                    ? formatZar(s.deliveryCost)
                    : "UNKNOWN"}
                </td>
                <td className="mono">
                  {s.totalLanded != null ? formatZar(s.totalLanded) : "UNKNOWN"}
                </td>
                <td>{s.leadTimeDays != null ? `${s.leadTimeDays}d` : "—"}</td>
                <td className="text-xs">
                  {s.validUntil
                    ? s.validUntil.toISOString().slice(0, 10)
                    : "—"}
                  {s.isExpired ? " · EXPIRED" : ""}
                </td>
                <td>
                  {s.flags.map((f) => (
                    <span
                      key={f}
                      className={`badge mr-1 ${
                        f === "CHEAPEST_COMPLETE_QUOTE"
                          ? "badge-green"
                          : "badge-amber"
                      }`}
                    >
                      {f}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
            {summaries.length === 0 && (
              <tr>
                <td colSpan={9} className="muted py-6 text-center">
                  No supplier quotes to summarise.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <div className="panel-header">
          SYSTEM_RECOMMENDATION — {recommendation.strategyType}
        </div>
        <div className="panel-body space-y-2 text-sm">
          <p>{recommendation.reason}</p>
          <p>
            Goods {formatZar(recommendation.goodsCost)}
            {recommendation.deliveryKnown
              ? ` + delivery ${formatZar(recommendation.deliveryCost)} = ${formatZar(recommendation.totalLandedEstimate ?? 0)}`
              : " · delivery UNKNOWN"}
          </p>
          {recommendation.blockers.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-[var(--danger,#a00)]">
              {recommendation.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <p className="muted text-xs">
            Cheapest incomplete / unverified / non-compliant quotes are never
            auto-selected. Founder must confirm before strategy is binding.
          </p>
          <div className="flex flex-wrap gap-2 pt-2">
            <form action={confirmSourcingStrategyAction}>
              <input type="hidden" name="rfqId" value={rfqId} />
              <input type="hidden" name="mode" value="ACCEPT_RECOMMENDATION" />
              <button type="submit" className="btn btn-primary" disabled={recommendation.lines.length === 0}>
                {strategyConfirmed
                  ? "Re-confirm SYSTEM_RECOMMENDATION"
                  : "Confirm SYSTEM_RECOMMENDATION"}
              </button>
            </form>
            <form action={refreshPricingFromQuotesAction}>
              <input type="hidden" name="rfqId" value={rfqId} />
              <button
                type="submit"
                className="btn"
                disabled={!strategyConfirmed}
              >
                Refresh pricing from verified quotes
              </button>
            </form>
          </div>
          <p className="text-xs">
            Pricing basis:{" "}
            <span className="badge badge-slate">{pricingBasis}</span>
            {!strategyConfirmed && (
              <span className="muted"> — confirm strategy before refresh</span>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
