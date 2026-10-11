import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { DemoBadge, StatusBadge, VatBadge } from "@/components/StatusBadge";


export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { documentType: "asc" } },
      rfqs: { orderBy: { closingAt: "asc" }, take: 20 },
    },
  });

  if (!company) notFound();

  return (
    <div className="space-y-4">
      <div>
        <Link href="/companies" className="text-xs text-[var(--accent)] hover:underline">
          ← Companies
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">
            {company.tradingName ?? company.legalName}
          </h1>
          {company.isDemo && <DemoBadge />}
          <VatBadge vatRegistered={company.vatRegistered} />
        </div>
        <p className="muted mt-1">{company.legalName}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-header">Profile</div>
          <div className="panel-body space-y-2 text-sm">
            <Row label="Registration" value={company.registrationNumber} />
            <Row label="CSD" value={company.csdNumber} />
            <Row label="Tax number" value={company.taxNumber} />
            <Row label="VAT number" value={company.vatNumber} />
            <Row label="B-BBEE" value={company.beeLevel} />
            <Row label="Province" value={company.province} />
            <Row label="Contact" value={company.contactName} />
            <Row label="Email" value={company.contactEmail} />
            <Row label="Phone" value={company.contactPhone} />
            <Row label="Commodities" value={company.commodityNotes} />
            <Row label="Coverage" value={company.geographicCoverage} />
            <Row label="Notes" value={company.notes} />
          </div>
        </div>

        <div className="panel overflow-x-auto">
          <div className="panel-header">Document vault</div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Expiry</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {company.documents.map((doc) => (
                <tr key={doc.id}>
                  <td>{doc.documentType}</td>
                  <td>{doc.title}</td>
                  <td className="text-xs">
                    {formatDateTime(doc.expiryDate)}
                  </td>
                  <td>
                    <span className="badge badge-slate">
                      {doc.verificationState.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {company.documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted py-6 text-center">
                    No documents in vault.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <div className="panel-header">RFQs for this company</div>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Internal ID</th>
              <th>Title</th>
              <th>Status</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {company.rfqs.map((rfq) => (
              <tr key={rfq.id}>
                <td className="mono">
                  <Link
                    href={`/rfqs/${rfq.id}`}
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {rfq.internalId}
                  </Link>
                </td>
                <td>{rfq.title}</td>
                <td>
                  <StatusBadge status={rfq.status} />
                </td>
                <td className="text-xs">{formatDateTime(rfq.closingAt)}</td>
              </tr>
            ))}
            {company.rfqs.length === 0 && (
              <tr>
                <td colSpan={4} className="muted py-6 text-center">
                  No RFQs assigned.
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
