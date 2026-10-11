import Link from "next/link";
import { prisma } from "@/lib/db";
import { evaluateDeadline } from "@/domain/deadlines";
import { PIPELINE_STATUSES } from "@/domain/status";
import { formatDateTime } from "@/lib/format";
import {
  DeadlineBadge,
  DemoBadge,
  GateBadge,
  StatusBadge,
} from "@/components/StatusBadge";
import type { PipelineStatus } from "@prisma/client";


export default async function RfqsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = params.status as PipelineStatus | undefined;
  const q = params.q?.trim();

  const rfqs = await prisma.rfq.findMany({
    where: {
      AND: [
        statusFilter && PIPELINE_STATUSES.includes(statusFilter as never)
          ? { status: statusFilter }
          : {},
        q
          ? {
              OR: [
                { internalId: { contains: q } },
                { title: { contains: q } },
                { buyer: { contains: q } },
                { tenderNumber: { contains: q } },
                { category: { contains: q } },
                { province: { contains: q } },
              ],
            }
          : {},
      ],
    },
    include: { selectedCompany: true },
    orderBy: { closingAt: "asc" },
  });

  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">RFQs</h1>
          <p className="muted mt-1">
            Pipeline of supply-and-deliver opportunities. All seed rows are DEMO.
          </p>
        </div>
        <DemoBadge />
      </div>

      <form className="panel panel-body flex flex-wrap items-end gap-3">
        <div className="field min-w-[220px] flex-1">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="RFQ number, buyer, keyword…"
          />
        </div>
        <div className="field min-w-[200px]">
          <label htmlFor="status">Status</label>
          <select
            id="status"
            name="status"
            defaultValue={statusFilter ?? ""}
            className="border border-[var(--border-strong)] bg-white px-3 py-2"
          >
            <option value="">All statuses</option>
            {PIPELINE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          Filter
        </button>
        <Link href="/rfqs" className="btn">
          Reset
        </Link>
      </form>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Internal ID</th>
              <th>Tender / Buyer</th>
              <th>Category</th>
              <th>Company</th>
              <th>Status</th>
              <th>Gate</th>
              <th>Closing</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {rfqs.map((rfq) => {
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
                      {rfq.tenderNumber ?? "—"} · {rfq.buyer}
                    </div>
                  </td>
                  <td>
                    <div>{rfq.category ?? "—"}</div>
                    <div className="muted text-xs">{rfq.province ?? ""}</div>
                  </td>
                  <td>
                    {rfq.selectedCompany?.tradingName ??
                      rfq.selectedCompany?.legalName ??
                      "Unassigned"}
                  </td>
                  <td>
                    <StatusBadge status={rfq.status} />
                  </td>
                  <td>
                    <GateBadge gate={rfq.profitabilityGate} />
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
            {rfqs.length === 0 && (
              <tr>
                <td colSpan={8} className="muted py-8 text-center">
                  No RFQs match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
