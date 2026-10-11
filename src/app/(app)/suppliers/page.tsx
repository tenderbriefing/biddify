import Link from "next/link";
import { prisma } from "@/lib/db";
import { DemoBadge } from "@/components/StatusBadge";


export default async function SuppliersPage() {
  const suppliers = await prisma.supplier.findMany({
    include: {
      contacts: true,
      _count: { select: { quotes: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="muted mt-1">
            Reusable supplier intelligence. Historical quotes accumulate over time.
          </p>
        </div>
        <DemoBadge />
      </div>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Categories</th>
              <th>Coverage</th>
              <th>Payment terms</th>
              <th>Primary contact</th>
              <th>Quotes</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const primary =
                s.contacts.find((c) => c.isPrimary) ?? s.contacts[0];
              return (
                <tr key={s.id}>
                  <td>
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      {s.name}
                    </Link>
                    {s.isDemo && (
                      <div className="mt-1">
                        <DemoBadge />
                      </div>
                    )}
                  </td>
                  <td className="text-xs">{s.categories ?? "—"}</td>
                  <td className="text-xs">{s.geographicCoverage ?? "—"}</td>
                  <td className="text-xs">{s.paymentTerms ?? "—"}</td>
                  <td className="text-xs">
                    {primary
                      ? `${primary.name}${primary.email ? ` · ${primary.email}` : ""}`
                      : s.email ?? "—"}
                  </td>
                  <td className="mono">{s._count.quotes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
