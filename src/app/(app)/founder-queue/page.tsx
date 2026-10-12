import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatDateTime, formatPercent, formatZar } from "@/lib/format";
import { GateBadge, StatusBadge } from "@/components/StatusBadge";

export default async function FounderBidQueuePage() {
  const rfqs = await prisma.rfq.findMany({
    where: {
      OR: [{ inFounderBidQueue: true }, { status: "FOUNDER_REVIEW" }],
      isDemo: false,
      dataMode: "OPERATIONAL",
      isRealSource: true,
    },
    include: {
      selectedCompany: true,
      pricingScenarios: { where: { isSelected: true }, take: 1 },
    },
    orderBy: [{ bidPriority: "desc" }, { closingAt: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Founder Bid Queue</h1>
        <p className="muted mt-1">
          Serious candidate opportunities only. Capital allocation and final
          government bid approval remain Founder decisions.
        </p>
      </div>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Buyer</th>
              <th>Company</th>
              <th>Closes</th>
              <th>Proposed bid</th>
              <th>Landed</th>
              <th>GP</th>
              <th>Margin</th>
              <th>Cash</th>
              <th>Cost conf.</th>
              <th>Spec conf.</th>
              <th>Gate</th>
              <th>Priority</th>
              <th>Next</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((r) => {
              const p = r.pricingScenarios[0];
              return (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/rfqs/${r.id}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      {r.internalId}
                    </Link>
                    <div className="muted max-w-[14rem] truncate text-xs">
                      {r.title}
                    </div>
                  </td>
                  <td className="text-xs">{r.buyer}</td>
                  <td className="text-xs">
                    {r.selectedCompany ? (
                      r.selectedCompany.tradingName ?? r.selectedCompany.legalName
                    ) : (
                      <span className="badge badge-amber">UNASSIGNED</span>
                    )}
                  </td>
                  <td className="text-xs">
                    {formatDateTime(r.closingAt, r.timezone)}
                  </td>
                  <td className="mono text-xs">
                    {p ? formatZar(Number(p.totalQuotation)) : "—"}
                  </td>
                  <td className="mono text-xs">
                    {p ? formatZar(Number(p.landedCost)) : "—"}
                  </td>
                  <td className="mono text-xs">
                    {p ? formatZar(Number(p.grossProfit)) : "—"}
                  </td>
                  <td className="mono text-xs">
                    {p ? formatPercent(Number(p.grossMarginPercent)) : "—"}
                  </td>
                  <td className="mono text-xs">
                    {p
                      ? formatZar(
                          Number(p.upfrontCashRequired ?? p.workingCapitalRequired),
                        )
                      : "—"}
                  </td>
                  <td className="mono text-xs">{r.costConfidence ?? "—"}</td>
                  <td className="mono text-xs">{r.specConfidence ?? "—"}</td>
                  <td>
                    <GateBadge gate={r.profitabilityGate} />
                  </td>
                  <td className="mono text-xs">{r.bidPriority ?? "—"}</td>
                  <td className="text-xs">
                    <StatusBadge status={r.status} />
                    <div className="muted mt-1">
                      {r.nextAction?.replaceAll("_", " ") ?? "—"}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rfqs.length === 0 && (
              <tr>
                <td colSpan={14} className="muted py-8 text-center">
                  No operational candidates in the Founder Bid Queue yet. Qualify
                  real RFQs, complete sourcing, then promote candidates with
                  evidence — not DEMO data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
