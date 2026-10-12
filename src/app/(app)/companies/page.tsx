import Link from "next/link";
import { prisma } from "@/lib/db";
import { DemoBadge, VatBadge } from "@/components/StatusBadge";


export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({
    include: {
      _count: { select: { rfqs: true, documents: true } },
    },
    orderBy: { legalName: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Companies</h1>
          <p className="muted mt-1">
            Operational companies only for real RFQs. DEMO/TEST fixtures cannot
            send email or bid. VAT status is never inferred.
          </p>
        </div>
        <DemoBadge />
      </div>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Mode</th>
              <th>Registration</th>
              <th>VAT</th>
              <th>Readiness</th>
              <th>Outbound</th>
              <th>RFQs</th>
              <th>Docs</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link
                    href={`/companies/${c.id}`}
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {c.tradingName ?? c.legalName}
                  </Link>
                  <div className="muted text-xs">{c.legalName}</div>
                  {c.isDemo && (
                    <div className="mt-1">
                      <DemoBadge />
                    </div>
                  )}
                </td>
                <td>
                  <span className="badge badge-slate">
                    {c.dataMode ?? (c.isDemo ? "TEST" : "OPERATIONAL")}
                  </span>
                </td>
                <td className="mono text-xs">{c.registrationNumber ?? "—"}</td>
                <td>
                  <VatBadge vatRegistered={c.vatRegistered} />
                  {!c.vatStatusKnown && (
                    <div className="muted text-[10px]">VAT UNKNOWN</div>
                  )}
                </td>
                <td>
                  <span
                    className={`badge ${
                      c.readinessOverall === "READY"
                        ? "badge-green"
                        : "badge-amber"
                    }`}
                  >
                    {c.readinessOverall}
                  </span>
                </td>
                <td>
                  <span
                    className={`badge ${
                      c.outboundSourcingEnabled ? "badge-green" : "badge-red"
                    }`}
                  >
                    {c.outboundSourcingEnabled ? "ON" : "OFF"}
                  </span>
                </td>
                <td className="mono">{c._count.rfqs}</td>
                <td className="mono">{c._count.documents}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
