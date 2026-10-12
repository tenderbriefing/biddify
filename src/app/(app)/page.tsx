import Link from "next/link";
import { prisma } from "@/lib/db";
import { evaluateDeadline } from "@/domain/deadlines";
import { formatDateTime, formatZar } from "@/lib/format";
import {
  DeadlineBadge,
  DemoBadge,
  GateBadge,
  StatusBadge,
} from "@/components/StatusBadge";


export default async function OperationsDashboard() {
  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 3600000);
  const in7d = new Date(now.getTime() + 7 * 86400000);

  const [
    rfqs,
    companies,
    suppliers,
    pricingScenarios,
    openStatuses,
  ] = await Promise.all([
    prisma.rfq.findMany({
      include: {
        selectedCompany: true,
        pricingScenarios: { where: { isSelected: true }, take: 1 },
        complianceItems: true,
      },
      orderBy: { closingAt: "asc" },
    }),
    prisma.company.count(),
    prisma.supplier.count(),
    prisma.pricingScenario.findMany({ where: { isSelected: true } }),
    prisma.rfq.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);

  const active = rfqs.filter(
    (r) => !["LOST", "NO_BID", "CANCELLED", "PAID"].includes(r.status),
  );

  const deadlinesToday = active.filter((r) => {
    const d = evaluateDeadline(r.closingAt, now, r.timezone);
    return !d.isClosed && d.hoursRemaining <= 24;
  });
  const deadlines48h = active.filter((r) => {
    const t = r.closingAt.getTime();
    return t > now.getTime() && t <= in48h.getTime();
  });
  const deadlinesWeek = active.filter((r) => {
    const t = r.closingAt.getTime();
    return t > now.getTime() && t <= in7d.getTime();
  });

  const needsFounder = active.filter((r) => r.status === "FOUNDER_REVIEW");
  const complianceBlocked = active.filter((r) =>
    r.complianceItems.some(
      (c) =>
        c.isMandatory &&
        ["MISSING", "EXPIRED", "NEEDS_SIGNATURE"].includes(c.state),
    ),
  );
  const awaitingSuppliers = active.filter((r) =>
    ["SOURCING", "AWAITING_SUPPLIERS"].includes(r.status),
  );
  const pricingIncomplete = active.filter(
    (r) =>
      ["PRICING", "QUALIFIED", "SOURCING"].includes(r.status) &&
      r.pricingScenarios.length === 0,
  );
  const actionQueue = [...active]
    .filter((r) => r.nextAction && r.nextAction !== "AWAIT_DEADLINE")
    .sort((a, b) => a.closingAt.getTime() - b.closingAt.getTime());
  const realSourceCount = rfqs.filter((r) => r.isRealSource).length;
  const needsDocReview = active.filter((r) =>
    ["DOWNLOAD_DOCUMENTS", "REVIEW_DOCUMENTS", "VERIFY_EXTRACTION"].includes(
      r.nextAction ?? "",
    ),
  ).length;
  const readyForSourcing = active.filter((r) =>
    ["SOURCE_SUPPLIERS", "READY_FOR_SOURCING", "REQUEST_QUOTES"].includes(
      r.nextAction ?? "",
    ),
  ).length;
  const quotesRequired = active.filter((r) =>
    ["REQUEST_QUOTES", "AWAIT_QUOTES"].includes(r.nextAction ?? ""),
  ).length;
  const pricingIncompleteCount = active.filter((r) =>
    ["COMPARE_QUOTES", "CALCULATE_LOGISTICS", "REVIEW_PRICING"].includes(
      r.nextAction ?? "",
    ),
  ).length;
  const commercialReview = active.filter((r) =>
    ["READY_FOR_COMMERCIAL_REVIEW", "VERIFY_WORKING_CAPITAL", "FOUNDERS_REVIEW"].includes(
      r.nextAction ?? "",
    ),
  ).length;
  const gateGreen = active.filter((r) => r.profitabilityGate === "GREEN").length;
  const gateAmber = active.filter((r) => r.profitabilityGate === "AMBER").length;
  const gateRed = active.filter((r) => r.profitabilityGate === "RED").length;

  const submitted = rfqs.filter((r) =>
    ["SUBMITTED", "AWARDED", "FULFILMENT", "PAID"].includes(r.status),
  );
  const awarded = rfqs.filter((r) =>
    ["AWARDED", "FULFILMENT", "PAID"].includes(r.status),
  );

  const openBidValue = pricingScenarios.reduce(
    (sum, s) => sum + Number(s.totalQuotation),
    0,
  );
  const expectedGp = pricingScenarios.reduce(
    (sum, s) => sum + Number(s.grossProfit),
    0,
  );

  const statusCounts = Object.fromEntries(
    openStatuses.map((s) => [s.status, s._count._all]),
  );

  const pipelineOrder = [
    "NEW",
    "QUALIFIED",
    "SOURCING",
    "PRICING",
    "COMPLIANCE",
    "FOUNDER_REVIEW",
    "APPROVED",
    "SUBMITTED",
    "AWARDED",
  ] as const;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="muted mt-1">
            What needs attention, what closes soon, what is blocked, and what is
            profitable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="badge badge-slate">{companies} companies</span>
          <span className="badge badge-slate">{suppliers} suppliers</span>
          <span className="badge badge-slate">{rfqs.length} RFQs</span>
          <span className="badge badge-green">{realSourceCount} REAL</span>
          <DemoBadge />
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Open bid value"
          value={formatZar(openBidValue)}
          hint="Selected pricing scenarios"
        />
        <Metric
          label="Expected gross profit"
          value={formatZar(expectedGp)}
          hint="From selected scenarios"
        />
        <Metric
          label="Submitted"
          value={String(submitted.length)}
          hint="Includes awarded / fulfilment"
        />
        <Metric
          label="Awarded"
          value={String(awarded.length)}
          hint="DEMO outcomes only"
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="panel lg:col-span-1">
          <div className="panel-header">Deadlines</div>
          <div className="panel-body space-y-3">
            <DeadlineGroup title="Today / 24h" items={deadlinesToday} now={now} />
            <DeadlineGroup title="Next 48 hours" items={deadlines48h} now={now} />
            <DeadlineGroup title="This week" items={deadlinesWeek} now={now} />
          </div>
        </div>

        <div className="panel lg:col-span-1">
          <div className="panel-header">Action required</div>
          <div className="panel-body space-y-2 text-sm">
            <ActionRow
              label="Document review"
              count={needsDocReview}
              href="/rfqs"
              tone={needsDocReview ? "amber" : "ok"}
            />
            <ActionRow
              label="Ready for sourcing"
              count={readyForSourcing}
              href="/rfqs"
              tone={readyForSourcing ? "amber" : "ok"}
            />
            <ActionRow
              label="Quotes required / awaiting"
              count={quotesRequired || awaitingSuppliers.length}
              href="/rfqs"
              tone={quotesRequired || awaitingSuppliers.length ? "amber" : "ok"}
            />
            <ActionRow
              label="Pricing incomplete"
              count={pricingIncompleteCount || pricingIncomplete.length}
              href="/rfqs"
              tone={
                pricingIncompleteCount || pricingIncomplete.length
                  ? "amber"
                  : "ok"
              }
            />
            <ActionRow
              label="Commercial review"
              count={commercialReview || needsFounder.length}
              href="/rfqs"
              tone={
                commercialReview || needsFounder.length ? "amber" : "ok"
              }
            />
            <ActionRow
              label="Compliance missing"
              count={complianceBlocked.length}
              href="/rfqs"
              tone={complianceBlocked.length ? "red" : "ok"}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="badge badge-green">GREEN {gateGreen}</span>
              <span className="badge badge-amber">AMBER {gateAmber}</span>
              <span className="badge badge-red">RED {gateRed}</span>
            </div>
          </div>
        </div>

        <div className="panel lg:col-span-1">
          <div className="panel-header">Pipeline</div>
          <div className="panel-body">
            <div className="grid grid-cols-3 gap-2">
              {pipelineOrder.map((status) => (
                <Link
                  key={status}
                  href={`/rfqs?status=${status}`}
                  className="border border-[var(--border)] bg-[#f8fafc] px-2 py-2 hover:bg-white"
                >
                  <div className="metric-label">{status.replaceAll("_", " ")}</div>
                  <div className="mt-1 text-lg font-bold">
                    {statusCounts[status] ?? 0}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <span>Immediate next actions</span>
          <Link href="/rfqs" className="btn text-xs">
            All RFQs
          </Link>
        </div>
        <div className="overflow-x-auto border-b border-[var(--border)]">
          <table className="ops-table">
            <thead>
              <tr>
                <th>RFQ</th>
                <th>Next action</th>
                <th>Qualification</th>
                <th>Closes</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {actionQueue.slice(0, 8).map((rfq) => (
                <tr key={`action-${rfq.id}`}>
                  <td className="mono">
                    <Link
                      href={`/rfqs/${rfq.id}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      {rfq.internalId}
                    </Link>
                  </td>
                  <td>
                    <div className="font-medium">
                      {rfq.nextAction?.replaceAll("_", " ")}
                    </div>
                    <div className="muted text-xs">{rfq.nextActionReason}</div>
                  </td>
                  <td>
                    <GateBadge gate={rfq.qualificationGate} />
                  </td>
                  <td className="text-xs">
                    {formatDateTime(rfq.closingAt, rfq.timezone)}
                  </td>
                  <td>
                    {rfq.isRealSource ? (
                      <span className="badge badge-green">REAL</span>
                    ) : (
                      <DemoBadge />
                    )}
                  </td>
                </tr>
              ))}
              {actionQueue.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted py-4 text-center">
                    No open next actions.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="panel-header border-t border-[var(--border)]">
          <span>Attention queue</span>
        </div>
        <div className="overflow-x-auto">
          <table className="ops-table">
            <thead>
              <tr>
                <th>Internal ID</th>
                <th>Title</th>
                <th>Company</th>
                <th>Status</th>
                <th>Gate</th>
                <th>Closes</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {active.slice(0, 12).map((rfq) => {
                const deadline = evaluateDeadline(
                  rfq.closingAt,
                  now,
                  rfq.timezone,
                );
                return (
                  <tr key={rfq.id}>
                    <td className="mono">
                      <Link
                        href={`/rfqs/${rfq.id}`}
                        className="font-semibold text-[var(--accent)] hover:underline"
                      >
                        {rfq.internalId}
                      </Link>
                      {rfq.isDemo && (
                        <div className="mt-1">
                          <DemoBadge />
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="font-medium">{rfq.title}</div>
                      <div className="muted text-xs">
                        {rfq.buyer}
                        {rfq.tenderNumber ? ` · ${rfq.tenderNumber}` : ""}
                      </div>
                    </td>
                    <td>
                      {rfq.selectedCompany?.tradingName ??
                        rfq.selectedCompany?.legalName ??
                        "—"}
                    </td>
                    <td>
                      <StatusBadge status={rfq.status} />
                    </td>
                    <td>
                      <GateBadge gate={rfq.qualificationGate} />
                    </td>
                    <td className="whitespace-nowrap text-xs">
                      {formatDateTime(rfq.closingAt, rfq.timezone)}
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <DeadlineBadge warning={deadline.warning} />
                        <span className="mono text-xs">{deadline.label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="panel panel-body">
      <div className="metric-label">{label}</div>
      <div className="metric-value mt-1">{value}</div>
      <div className="muted mt-1 text-xs">{hint}</div>
    </div>
  );
}

function DeadlineGroup({
  title,
  items,
  now,
}: {
  title: string;
  items: { id: string; internalId: string; title: string; closingAt: Date; timezone: string }[];
  now: Date;
}) {
  return (
    <div>
      <div className="metric-label mb-1">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <div className="muted text-xs">None</div>
      ) : (
        <ul className="space-y-1">
          {items.slice(0, 5).map((item) => {
            const d = evaluateDeadline(item.closingAt, now, item.timezone);
            return (
              <li key={item.id} className="text-sm">
                <Link
                  href={`/rfqs/${item.id}`}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  {item.internalId}
                </Link>
                <span className="muted"> · {d.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActionRow({
  label,
  count,
  href,
  tone,
}: {
  label: string;
  count: number;
  href: string;
  tone: "ok" | "amber" | "red";
}) {
  const cls =
    tone === "red" ? "badge-red" : tone === "amber" ? "badge-amber" : "badge-green";
  return (
    <Link
      href={href}
      className="flex items-center justify-between border border-[var(--border)] px-3 py-2 hover:bg-[#f8fafc]"
    >
      <span>{label}</span>
      <span className={`badge ${cls}`}>{count}</span>
    </Link>
  );
}
