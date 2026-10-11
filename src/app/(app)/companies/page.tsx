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
            Multiple bidding companies. VAT status is explicit and never inferred.
          </p>
        </div>
        <DemoBadge />
      </div>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Company</th>
              <th>Registration</th>
              <th>VAT</th>
              <th>B-BBEE</th>
              <th>Coverage</th>
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
                <td className="mono text-xs">{c.registrationNumber ?? "—"}</td>
                <td>
                  <VatBadge vatRegistered={c.vatRegistered} />
                </td>
                <td>{c.beeLevel ?? "—"}</td>
                <td className="text-xs">{c.geographicCoverage ?? "—"}</td>
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
