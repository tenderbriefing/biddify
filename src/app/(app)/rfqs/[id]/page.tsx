import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { evaluateDeadline } from "@/domain/deadlines";
import { evaluateComplianceGate } from "@/domain/compliance";
import {
  formatDateTime,
  formatPercent,
  formatZar,
  vatLabel,
} from "@/lib/format";
import {
  DeadlineBadge,
  DemoBadge,
  GateBadge,
  StatusBadge,
  VatBadge,
} from "@/components/StatusBadge";
import { QualificationPanel } from "@/components/QualificationPanel";
import { formatClosingDisplay } from "@/domain/deadlineParse";

const TABS = [
  "overview",
  "specifications",
  "documents",
  "suppliers",
  "quotes",
  "pricing",
  "compliance",
  "approval",
  "activity",
] as const;

type Tab = (typeof TABS)[number];

export default async function RfqWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS.includes(sp.tab as Tab) ? sp.tab : "overview") as Tab;

  const rfq = await prisma.rfq.findUnique({
    where: { id },
    include: {
      selectedCompany: true,
      lineItems: { orderBy: { lineNumber: "asc" } },
      requirements: true,
      documents: true,
      quotes: {
        include: {
          supplier: true,
          lineItems: true,
        },
      },
      pricingScenarios: {
        include: { lineItems: true },
        orderBy: { createdAt: "desc" },
      },
      complianceItems: true,
      statusEvents: {
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      bids: {
        include: { approvals: { include: { approver: true } } },
      },
    },
  });

  if (!rfq) notFound();

  const now = new Date();
  const deadline = evaluateDeadline(rfq.closingAt, now, rfq.timezone);
  const compliance = evaluateComplianceGate(rfq.complianceItems);
  const selectedPricing =
    rfq.pricingScenarios.find((s) => s.isSelected) ?? rfq.pricingScenarios[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Link href="/rfqs" className="text-xs text-[var(--accent)] hover:underline">
              ← RFQs
            </Link>
            {rfq.isDemo && <DemoBadge />}
            {rfq.isRealSource && (
              <span className="badge badge-green">REAL SOURCE</span>
            )}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{rfq.title}</h1>
          <div className="muted mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span className="mono font-semibold text-[var(--fg)]">
              {rfq.internalId}
            </span>
            <span>{rfq.tenderNumber ?? "No tender number"}</span>
            <span>{rfq.buyer}</span>
            <span>{rfq.province ?? "—"}</span>
            {rfq.classification && (
              <span className="badge badge-slate">
                {rfq.classification.replaceAll("_", " ")}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={rfq.status} />
          <GateBadge gate={rfq.qualificationGate} />
          <DeadlineBadge warning={deadline.warning} />
          <span className="mono text-sm">{deadline.label}</span>
        </div>
      </div>

      <div className="panel panel-body grid gap-3 md:grid-cols-4">
        <Fact
          label="Closing"
          value={formatClosingDisplay(
            rfq.closingAt,
            rfq.closingTimeKnown,
            rfq.timezone,
          )}
        />
        <Fact label="Submission" value={rfq.submissionMethod} />
        <Fact
          label="Compulsory briefing"
          value={
            !rfq.briefingCompulsoryKnown
              ? "UNKNOWN — check documents"
              : rfq.briefingCompulsory
                ? `YES${rfq.briefingDate ? ` · ${formatDateTime(rfq.briefingDate, rfq.timezone)}` : ""}`
                : "NO / not indicated"
          }
        />
        <Fact
          label="Next action"
          value={rfq.nextAction?.replaceAll("_", " ") ?? "—"}
        />
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => {
          const active = tab === t;
          return (
            <Link
              key={t}
              href={`/rfqs/${rfq.id}?tab=${t}`}
              className={`px-3 py-2 text-xs font-semibold uppercase tracking-[0.04em] ${
                active
                  ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
              }`}
            >
              {t}
            </Link>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="panel">
              <div className="panel-header">What is this opportunity?</div>
              <div className="panel-body space-y-2 text-sm">
                <FactRow label="What" value={rfq.title} />
                <FactRow label="Who is buying" value={rfq.buyer} />
                <FactRow
                  label="What they want"
                  value={rfq.description ?? "See source documents"}
                />
                <FactRow
                  label="When it closes"
                  value={formatClosingDisplay(
                    rfq.closingAt,
                    rfq.closingTimeKnown,
                    rfq.timezone,
                  )}
                />
                <FactRow label="How to submit" value={rfq.submissionMethod} />
                <FactRow
                  label="Compulsory briefing"
                  value={
                    !rfq.briefingCompulsoryKnown
                      ? "UNKNOWN"
                      : rfq.briefingCompulsory
                        ? "YES"
                        : "NO / not indicated"
                  }
                />
                <FactRow
                  label="Bidding company"
                  value={
                    rfq.selectedCompany
                      ? rfq.selectedCompany.tradingName ??
                        rfq.selectedCompany.legalName
                      : "Unassigned — select before sourcing"
                  }
                />
                <FactRow
                  label="Blocking us"
                  value={
                    rfq.status === "NO_BID"
                      ? rfq.noBidReason
                      : compliance.submissionReady
                        ? rfq.nextActionReason ?? "None flagged"
                        : `${compliance.blockingItems.length} compliance item(s) · ${rfq.nextActionReason ?? ""}`
                  }
                />
                {rfq.duplicateGroupId && (
                  <FactRow
                    label="Duplicate group"
                    value="Linked probable duplicate detected — do not auto-bid multiple companies"
                  />
                )}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">Source provenance</div>
              <div className="panel-body space-y-2 text-sm">
                <FactRow label="Source" value={rfq.source} />
                <FactRow label="Source ID" value={rfq.sourceOpportunityId} />
                <FactRow label="OCID" value={rfq.ocid} />
                <FactRow
                  label="Source URL"
                  value={rfq.sourceUrl}
                />
                <FactRow
                  label="Published"
                  value={formatDateTime(rfq.sourcePublishedAt ?? rfq.publicationDate, rfq.timezone)}
                />
                <FactRow
                  label="Source last modified"
                  value={formatDateTime(rfq.sourceLastModifiedAt, rfq.timezone)}
                />
                <FactRow
                  label="Imported at"
                  value={formatDateTime(rfq.importedAt, rfq.timezone)}
                />
                <FactRow
                  label="Data class"
                  value={rfq.isRealSource ? "REAL SOURCE" : rfq.isDemo ? "DEMO" : "INTERNAL"}
                />
                {rfq.opportunityScore != null && (
                  <FactRow
                    label="Opportunity score"
                    value={`${rfq.opportunityScore} — transparent component score (see Activity/notes)`}
                  />
                )}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <QualificationPanel
              rfqId={rfq.id}
              classification={rfq.classification}
              classificationConfidence={rfq.classificationConfidence}
              classificationReasoning={rfq.classificationReasoning}
              qualificationGate={rfq.qualificationGate}
              qualificationReasons={rfq.qualificationReasons}
              nextAction={rfq.nextAction}
              nextActionReason={rfq.nextActionReason}
              status={rfq.status}
            />

            <div className="panel">
              <div className="panel-header">Commercial snapshot</div>
              <div className="panel-body space-y-2 text-sm">
                {selectedPricing ? (
                  <>
                    <FactRow
                      label="Landed cost"
                      value={formatZar(Number(selectedPricing.landedCost))}
                    />
                    <FactRow
                      label="Gross profit"
                      value={formatZar(Number(selectedPricing.grossProfit))}
                    />
                    <FactRow
                      label="Gross margin"
                      value={formatPercent(Number(selectedPricing.grossMarginPercent))}
                    />
                    {selectedPricing.vatRegisteredSnapshot != null && (
                      <VatBadge
                        vatRegistered={selectedPricing.vatRegisteredSnapshot}
                      />
                    )}
                  </>
                ) : (
                  <p className="muted">
                    No supplier pricing yet — commercial margin not heavily scored.
                  </p>
                )}
                {rfq.selectedCompany && (
                  <div className="pt-2">
                    <VatBadge vatRegistered={rfq.selectedCompany.vatRegistered} />
                    <span className="muted ml-2 text-xs">
                      {vatLabel(rfq.selectedCompany.vatRegistered)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "specifications" && (
        <div className="space-y-3">
          <div className="panel overflow-x-auto">
            <div className="panel-header">Line items</div>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product / Description</th>
                  <th>Specification</th>
                  <th>Brand</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Equiv.</th>
                </tr>
              </thead>
              <tbody>
                {rfq.lineItems.map((li) => (
                  <tr key={li.id}>
                    <td className="mono">{li.lineNumber}</td>
                    <td>
                      <div className="font-medium">{li.product ?? li.description}</div>
                      {li.product && (
                        <div className="muted text-xs">{li.description}</div>
                      )}
                    </td>
                    <td className="text-xs">{li.specification ?? "—"}</td>
                    <td className="text-xs">{li.brandRequirement ?? "—"}</td>
                    <td className="mono">{Number(li.quantity)}</td>
                    <td>{li.unit}</td>
                    <td>{li.equivalentAllowed ? "Yes" : "No"}</td>
                  </tr>
                ))}
                {rfq.lineItems.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted py-6 text-center">
                      No line items captured.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <div className="panel-header">Requirements</div>
            <ul className="panel-body space-y-2 text-sm">
              {rfq.requirements.map((req) => (
                <li key={req.id} className="border border-[var(--border)] px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{req.description}</span>
                    <span className="badge badge-slate">{req.category}</span>
                    {req.isMandatory ? (
                      <span className="badge badge-amber">Mandatory</span>
                    ) : (
                      <span className="badge badge-slate">Optional</span>
                    )}
                  </div>
                  {req.sourceHint && (
                    <div className="muted mt-1 text-xs">Source: {req.sourceHint}</div>
                  )}
                </li>
              ))}
              {rfq.requirements.length === 0 && (
                <li className="muted">No requirements captured.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div className="panel overflow-x-auto">
          <div className="panel-header">Documents (source preserved)</div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rfq.documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="mono">{doc.fileName}</td>
                  <td>{doc.documentType ?? "—"}</td>
                  <td>{doc.isSource ? "Yes" : "Derived"}</td>
                  <td className="text-xs">{doc.notes ?? "—"}</td>
                </tr>
              ))}
              {rfq.documents.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted py-6 text-center">
                    No documents attached.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="panel">
          <div className="panel-header">Linked suppliers (via quotes)</div>
          <ul className="panel-body space-y-2 text-sm">
            {rfq.quotes.map((q) => (
              <li key={q.id} className="flex items-center justify-between border border-[var(--border)] px-3 py-2">
                <div>
                  <Link
                    href={`/suppliers/${q.supplier.id}`}
                    className="font-semibold text-[var(--accent)] hover:underline"
                  >
                    {q.supplier.name}
                  </Link>
                  <div className="muted text-xs">
                    {q.supplier.categories ?? "—"}
                  </div>
                </div>
                <span className="badge badge-slate">
                  {q.isComplete ? "Quote complete" : "Incomplete"}
                </span>
              </li>
            ))}
            {rfq.quotes.length === 0 && (
              <li className="muted">No suppliers linked yet.</li>
            )}
          </ul>
        </div>
      )}

      {tab === "quotes" && (
        <div className="space-y-3">
          {rfq.quotes.map((q) => (
            <div key={q.id} className="panel overflow-x-auto">
              <div className="panel-header">
                <span>
                  {q.supplier.name}
                  {q.quoteReference ? ` · ${q.quoteReference}` : ""}
                </span>
                <span className="badge badge-slate">
                  {q.isComplete ? "Complete" : "Incomplete"}
                </span>
              </div>
              <div className="panel-body grid gap-2 text-sm md:grid-cols-4">
                <Fact label="Delivery" value={formatZar(Number(q.deliveryCost))} />
                <Fact label="Lead time" value={q.leadTimeDays != null ? `${q.leadTimeDays} days` : "—"} />
                <Fact label="Payment" value={q.paymentTerms ?? "—"} />
                <Fact
                  label="Valid until"
                  value={formatDateTime(q.validUntil, rfq.timezone)}
                />
              </div>
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit cost</th>
                    <th>Line total</th>
                    <th>Brand</th>
                  </tr>
                </thead>
                <tbody>
                  {q.lineItems.map((li) => (
                    <tr key={li.id}>
                      <td>{li.description}</td>
                      <td className="mono">{Number(li.quantity)}</td>
                      <td className="mono">{formatZar(Number(li.unitCost))}</td>
                      <td className="mono">{formatZar(Number(li.lineTotal))}</td>
                      <td>{li.brandOffered ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {q.notes && (
                <div className="panel-body muted text-xs">Notes: {q.notes}</div>
              )}
            </div>
          ))}
          {rfq.quotes.length === 0 && (
            <div className="panel panel-body muted">No supplier quotes yet.</div>
          )}
        </div>
      )}

      {tab === "pricing" && (
        <div className="space-y-3">
          {rfq.pricingScenarios.map((s) => (
            <div key={s.id} className="panel">
              <div className="panel-header">
                <span>
                  {s.name} {s.isSelected ? "(selected)" : ""}
                </span>
                <GateBadge gate={s.profitabilityGate} />
              </div>
              <div className="panel-body grid gap-2 text-sm md:grid-cols-3">
                <Fact label="Supplier cost" value={formatZar(Number(s.supplierCostTotal))} />
                <Fact label="Delivery" value={formatZar(Number(s.deliveryCost))} />
                <Fact label="Logistics" value={formatZar(Number(s.logisticsCost))} />
                <Fact label="Contingency" value={formatZar(Number(s.contingencyCost))} />
                <Fact label="Landed cost" value={formatZar(Number(s.landedCost))} />
                <Fact label="Markup" value={formatPercent(Number(s.markupPercent))} />
                <Fact label="Sell ex VAT" value={formatZar(Number(s.sellingPriceExVat))} />
                <Fact label="VAT" value={formatZar(Number(s.vatAmount))} />
                <Fact label="Total quotation" value={formatZar(Number(s.totalQuotation))} />
                <Fact label="Gross profit" value={formatZar(Number(s.grossProfit))} />
                <Fact label="Gross margin" value={formatPercent(Number(s.grossMarginPercent))} />
                <Fact label="Working capital" value={formatZar(Number(s.workingCapitalRequired))} />
              </div>
              {s.vatRegisteredSnapshot != null && (
                <div className="px-4 pb-3">
                  <VatBadge vatRegistered={s.vatRegisteredSnapshot} />
                  <p className="muted mt-2 text-xs">
                    VAT is never inferred. Snapshot taken from selected company
                    VAT status at pricing time.
                  </p>
                </div>
              )}
              {s.notes && (
                <div className="border-t border-[var(--border)] px-4 py-3 text-xs">
                  {s.notes}
                </div>
              )}
            </div>
          ))}
          {rfq.pricingScenarios.length === 0 && (
            <div className="panel panel-body muted">
              No pricing scenarios. Commercial engine available in domain layer;
              UI editing arrives in Phase 4.
            </div>
          )}
        </div>
      )}

      {tab === "compliance" && (
        <div className="panel overflow-x-auto">
          <div className="panel-header">
            <span>Compliance checklist</span>
            <span
              className={`badge ${compliance.submissionReady ? "badge-green" : "badge-red"}`}
            >
              {compliance.submissionReady
                ? "Submission ready"
                : "Blocked"}
            </span>
          </div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Mandatory</th>
                <th>State</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rfq.complianceItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>{item.isMandatory ? "Yes" : "No"}</td>
                  <td>
                    <span
                      className={`badge ${
                        ["MISSING", "EXPIRED", "NEEDS_SIGNATURE"].includes(
                          item.state,
                        )
                          ? "badge-red"
                          : item.state === "VERIFIED" || item.state === "COMPLETED"
                            ? "badge-green"
                            : "badge-slate"
                      }`}
                    >
                      {item.state.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td className="text-xs">{item.notes ?? "—"}</td>
                </tr>
              ))}
              {rfq.complianceItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted py-6 text-center">
                    No compliance items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === "approval" && (
        <div className="panel">
          <div className="panel-header">Founder approval</div>
          <div className="panel-body space-y-3 text-sm">
            <p>
              Bids cannot reach <span className="mono">SUBMISSION_AUTHORISED</span>{" "}
              without a valid Founder approval. Material commercial changes
              invalidate approval.
            </p>
            {rfq.bids.flatMap((b) => b.approvals).length === 0 ? (
              <div className="border border-[var(--border)] bg-[#fff8e6] px-3 py-2 text-sm">
                No Founder approval recorded. Phase 7 will implement the approval
                queue. Current status: <StatusBadge status={rfq.status} />
              </div>
            ) : (
              rfq.bids.flatMap((b) =>
                b.approvals.map((a) => (
                  <div
                    key={a.id}
                    className="border border-[var(--border)] px-3 py-2"
                  >
                    <div className="font-semibold">
                      {a.approver.name} · {formatDateTime(a.approvedAt)}
                    </div>
                    <div className="muted text-xs">
                      Approved price {formatZar(Number(a.approvedPrice))} ·{" "}
                      {a.isValid ? "Valid" : "Invalidated"}
                    </div>
                  </div>
                )),
              )
            )}
          </div>
        </div>
      )}

      {tab === "activity" && (
        <div className="panel">
          <div className="panel-header">Status activity</div>
          <ul className="panel-body space-y-2 text-sm">
            {rfq.statusEvents.map((ev) => (
              <li key={ev.id} className="border border-[var(--border)] px-3 py-2">
                <div className="font-medium">
                  {ev.fromStatus ?? "—"} → {ev.toStatus}
                </div>
                <div className="muted text-xs">
                  {formatDateTime(ev.createdAt)} · {ev.user?.name ?? "System"}
                  {ev.reason ? ` · ${ev.reason}` : ""}
                </div>
              </li>
            ))}
            {rfq.statusEvents.length === 0 && (
              <li className="muted">No status events yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function FactRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-[var(--border)] py-1.5 last:border-0">
      <span className="w-40 shrink-0 text-xs font-semibold uppercase tracking-[0.03em] text-[var(--fg-muted)]">
        {label}
      </span>
      <span>{value || "—"}</span>
    </div>
  );
}
