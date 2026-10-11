import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime, formatZar } from "@/lib/format";
import { DemoBadge } from "@/components/StatusBadge";


export default async function SupplierDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supplier = await prisma.supplier.findUnique({
    where: { id },
    include: {
      contacts: true,
      quotes: {
        include: { rfq: true, lineItems: true },
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!supplier) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/suppliers" className="text-xs text-[var(--accent)] hover:underline">
          ← Suppliers
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{supplier.name}</h1>
          {supplier.isDemo && <DemoBadge />}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-header">Profile</div>
          <div className="panel-body space-y-2 text-sm">
            <Row label="Email" value={supplier.email} />
            <Row label="Telephone" value={supplier.telephone} />
            <Row label="Website" value={supplier.website} />
            <Row label="Categories" value={supplier.categories} />
            <Row label="Brands" value={supplier.brands} />
            <Row label="Coverage" value={supplier.geographicCoverage} />
            <Row label="Payment terms" value={supplier.paymentTerms} />
            <Row label="Delivery" value={supplier.deliveryCapability} />
            <Row label="Reliability" value={supplier.reliabilityNotes} />
            <Row label="Notes" value={supplier.notes} />
          </div>
        </div>
        <div className="panel">
          <div className="panel-header">Contacts</div>
          <ul className="panel-body space-y-2 text-sm">
            {supplier.contacts.map((c) => (
              <li key={c.id} className="border border-[var(--border)] px-3 py-2">
                <div className="font-medium">
                  {c.name}
                  {c.isPrimary ? " (primary)" : ""}
                </div>
                <div className="muted text-xs">
                  {[c.role, c.email, c.telephone].filter(Boolean).join(" · ") ||
                    "—"}
                </div>
              </li>
            ))}
            {supplier.contacts.length === 0 && (
              <li className="muted">No contacts.</li>
            )}
          </ul>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">Historical quotes</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>RFQ</th>
              <th>Reference</th>
              <th>Received</th>
              <th>Delivery</th>
              <th>Lines</th>
              <th>Complete</th>
            </tr>
          </thead>
          <tbody>
            {supplier.quotes.map((q) => (
              <tr key={q.id}>
                <td className="mono">
                  <Link
                    href={`/rfqs/${q.rfqId}`}
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {q.rfq.internalId}
                  </Link>
                </td>
                <td>{q.quoteReference ?? "—"}</td>
                <td className="text-xs">{formatDateTime(q.receivedAt)}</td>
                <td className="mono text-xs">
                  {formatZar(Number(q.deliveryCost))}
                </td>
                <td className="mono">{q.lineItems.length}</td>
                <td>{q.isComplete ? "Yes" : "No"}</td>
              </tr>
            ))}
            {supplier.quotes.length === 0 && (
              <tr>
                <td colSpan={6} className="muted py-6 text-center">
                  No quotes yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-3 border-b border-[var(--border)] py-1.5 last:border-0">
      <span className="w-36 shrink-0 text-xs font-semibold uppercase tracking-[0.03em] text-[var(--fg-muted)]">
        {label}
      </span>
      <span>{value || "—"}</span>
    </div>
  );
}
