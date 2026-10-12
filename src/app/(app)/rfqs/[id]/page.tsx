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
import {
  CommercialPanel,
  EvidenceBadge,
} from "@/components/CommercialPanel";
import { formatClosingDisplay } from "@/domain/deadlineParse";
import { buildFounderReviewPack } from "@/domain/founderReviewPack";
import { prepareFounderReviewAction } from "@/lib/rfq/actions";
import { QuoteCaptureForm } from "@/components/QuoteCaptureForm";
import { SupplierComparisonPanel } from "@/components/SupplierComparisonPanel";
import { FounderCommercialControls } from "@/components/FounderCommercialControls";
import {
  buildBoqComparison,
  isQuoteExpired,
  recommendSourcingStrategy,
  summariseSupplierQuotes,
} from "@/domain/commercialComparison";
import { evaluateSubmissionReadiness } from "@/domain/submissionReadiness";
import { pricingEvidenceLabel } from "@/domain/pricingRefresh";

const TABS = [
  "decision",
  "overview",
  "specifications",
  "documents",
  "suppliers",
  "quotes",
  "comparison",
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

  const [rfq, operationalCompanies, operationalSuppliers] = await Promise.all([
    prisma.rfq.findUnique({
      where: { id },
      include: {
        selectedCompany: true,
        lineItems: { orderBy: { lineNumber: "asc" } },
        requirements: true,
        documents: true,
        quotes: {
          include: {
            supplier: true,
            lineItems: { include: { rfqLineItem: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        enquiries: {
          include: { supplier: true },
          orderBy: { createdAt: "desc" },
        },
        sourcingRequests: {
          include: { supplier: true },
          orderBy: { reference: "asc" },
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
    }),
    prisma.company.findMany({
      where: { isDemo: false, dataMode: "OPERATIONAL", isActive: true },
      orderBy: { legalName: "asc" },
    }),
    prisma.supplier.findMany({
      where: { isDemo: false, dataMode: "OPERATIONAL", emailVerified: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!rfq) notFound();

  const now = new Date();
  const deadline = evaluateDeadline(rfq.closingAt, now, rfq.timezone);
  const compliance = evaluateComplianceGate(rfq.complianceItems);
  const selectedPricing =
    rfq.pricingScenarios.find((s) => s.isSelected) ?? rfq.pricingScenarios[0];

  let eligibilityVerdict: string | null = null;
  let eligibilityExplanation: string | null = null;
  let companyOverride = false;
  try {
    const sel = JSON.parse(rfq.companySelectionReason ?? "{}") as {
      eligibility?: { verdict?: string; warnings?: string[] };
      founderOverride?: boolean;
    };
    eligibilityVerdict = sel.eligibility?.verdict ?? null;
    eligibilityExplanation = (sel.eligibility?.warnings ?? []).join("; ") || null;
    companyOverride = Boolean(sel.founderOverride);
  } catch {
    /* ignore */
  }

  const founderPack = buildFounderReviewPack({
    internalId: rfq.internalId,
    title: rfq.title,
    buyer: rfq.buyer,
    closingDisplay: formatClosingDisplay(
      rfq.closingAt,
      rfq.closingTimeKnown,
      rfq.timezone,
    ),
    hoursRemaining: deadline.hoursRemaining,
    isClosed: deadline.isClosed,
    classification: rfq.classification,
    eligibilityVerdict,
    eligibilityExplanation,
    selectedCompanyName:
      rfq.selectedCompany?.tradingName ?? rfq.selectedCompany?.legalName,
    recommendedCompanyName: null,
    companyOverride,
    lineItems: rfq.lineItems.map((l) => ({
      lineNumber: l.lineNumber,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
      brandRequirement: l.brandRequirement,
    })),
    suppliers: [
      ...rfq.sourcingRequests.map((s) => ({
        name: s.supplier.name,
        email: s.recipientEmail,
        lifecycleStatus: s.lifecycleStatus,
      })),
      ...rfq.enquiries.map((e) => ({
        name: e.supplier.name,
        email: e.supplier.email,
        lifecycleStatus: e.deliveryState,
      })),
    ],
    landedCost: selectedPricing ? Number(selectedPricing.landedCost) : null,
    sellingPrice: selectedPricing
      ? Number(selectedPricing.totalQuotation)
      : null,
    grossProfit: selectedPricing ? Number(selectedPricing.grossProfit) : null,
    grossMarginPercent: selectedPricing
      ? Number(selectedPricing.grossMarginPercent)
      : null,
    markupPercent: selectedPricing
      ? Number(selectedPricing.markupPercent)
      : null,
    vatRegistered:
      selectedPricing?.vatRegisteredSnapshot ??
      rfq.selectedCompany?.vatRegistered,
    evidenceQuality: selectedPricing?.evidenceQuality,
    complianceBlocking: compliance.blockingItems.map((b) => b.label),
    complianceComplete: rfq.complianceItems
      .filter((c) =>
        ["AVAILABLE", "COMPLETED", "VERIFIED", "NOT_REQUIRED"].includes(c.state),
      )
      .map((c) => c.label),
    nextAction: rfq.nextAction,
    nextActionReason: rfq.nextActionReason,
    pipelineStatus: rfq.status,
    emailTransport: "PENDING_EMAIL_INTEGRATION",
  });

  const comparisonOffers = rfq.quotes.flatMap((q) =>
    q.lineItems
      .filter((li) => li.rfqLineItemId)
      .map((li) => ({
        rfqLineItemId: li.rfqLineItemId!,
        quoteId: q.id,
        quoteLineId: li.id,
        supplierId: q.supplierId,
        supplierName: q.supplier.name,
        unitCost: li.unitCost != null ? Number(li.unitCost) : null,
        lineTotal: li.lineTotal != null ? Number(li.lineTotal) : null,
        availability: li.availability,
        brandSku: [li.brandOffered, li.sku].filter(Boolean).join(" / ") || null,
        matchState: li.matchState,
        evidenceType: q.evidenceType,
        verificationState: q.verificationState,
      })),
  );

  const comparisonRows = buildBoqComparison(
    rfq.lineItems.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: Number(l.quantity),
      unit: l.unit,
    })),
    comparisonOffers,
  );

  const quoteSummaries = summariseSupplierQuotes({
    boqLineIds: rfq.lineItems.map((l) => l.id),
    quotes: rfq.quotes.map((q) => ({
      quoteId: q.id,
      supplierId: q.supplierId,
      supplierName: q.supplier.name,
      evidenceType: q.evidenceType,
      verificationState: q.verificationState,
      subtotal: q.subtotal != null ? Number(q.subtotal) : null,
      vatAmount: q.vatAmount != null ? Number(q.vatAmount) : null,
      deliveryCost: q.deliveryCost != null ? Number(q.deliveryCost) : null,
      deliveryKnown: q.deliveryKnown,
      validUntil: q.validUntil,
      leadTimeDays: q.leadTimeDays,
      coveredLineIds: q.lineItems
        .map((li) => li.rfqLineItemId)
        .filter((x): x is string => Boolean(x)),
      isCompleteClaim: q.isComplete,
    })),
  });

  const sourcingRecommendation = recommendSourcingStrategy({
    boq: rfq.lineItems.map((l) => ({
      id: l.id,
      quantity: Number(l.quantity),
    })),
    offers: comparisonOffers.map((o) => {
      const q = rfq.quotes.find((x) => x.id === o.quoteId)!;
      return {
        ...o,
        deliveryCost: q.deliveryCost != null ? Number(q.deliveryCost) : null,
        deliveryKnown: q.deliveryKnown,
        quoteExpired: isQuoteExpired(q.validUntil),
      };
    }),
  });

  const signaturesComplete = !rfq.complianceItems.some(
    (c) =>
      c.isMandatory &&
      (c.itemKey === "signatures" || /signature|MBD/i.test(c.label)) &&
      ["MISSING", "EXPIRED", "NEEDS_SIGNATURE"].includes(c.state),
  );

  const readiness = evaluateSubmissionReadiness({
    companySelected: Boolean(rfq.selectedCompanyId),
    eligibilityPassed:
      eligibilityVerdict === "ELIGIBLE" ||
      (eligibilityVerdict === "ELIGIBLE_WITH_WARNING" &&
        Boolean(rfq.eligibilityWarningAcceptedAt)),
    eligibilityWarningAccepted: Boolean(rfq.eligibilityWarningAcceptedAt),
    eligibilityVerdict,
    boqComplete: rfq.lineItems.length > 0,
    verifiedSupplierPricing: rfq.pricingBasis === "VERIFIED_SUPPLIER",
    sourcingStrategyConfirmed: rfq.sourcingStrategyConfirmed,
    commercialsFounderApproved: Boolean(rfq.commercialsApprovedAt),
    mandatoryComplianceComplete: compliance.submissionReady,
    signaturesComplete,
    unresolvedBlockingWarnings: [],
  });

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

      {tab === "decision" && (
        <div className="space-y-3">
          <div className="panel">
            <div className="panel-header flex flex-wrap items-center justify-between gap-2">
              <span>Founder decision pack — 12 operating questions</span>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`badge ${founderPack.readyForFounderReview ? "badge-green" : "badge-amber"}`}
                >
                  {founderPack.readyForFounderReview
                    ? "READY FOR FOUNDER REVIEW"
                    : "NOT READY FOR REVIEW"}
                </span>
                <span className="badge badge-slate">
                  EMAIL: PENDING_EMAIL_INTEGRATION
                </span>
                <span className="badge badge-slate">AUTONOMY OFF</span>
              </div>
            </div>
            <div className="panel-body space-y-3">
              {founderPack.questions.map((q) => (
                <div
                  key={q.id}
                  className="border border-[var(--border)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-xs font-semibold text-[var(--fg-muted)]">
                      Q{q.id}
                    </span>
                    <span className="font-semibold text-sm">{q.question}</span>
                    <span
                      className={`badge ${
                        q.status === "ANSWERED"
                          ? "badge-green"
                          : q.status === "BLOCKED"
                            ? "badge-red"
                            : "badge-amber"
                      }`}
                    >
                      {q.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed">{q.answer}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">What Founder must do next</div>
            <ol className="panel-body list-decimal space-y-1 pl-5 text-sm">
              {founderPack.whatFounderMustDoNext.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          <div className="panel panel-body text-sm">
            <div className="flex flex-wrap gap-2">
              <span
                className={`badge ${
                  rfq.pricingBasis === "VERIFIED_SUPPLIER"
                    ? "badge-green"
                    : "badge-amber"
                }`}
              >
                {pricingEvidenceLabel(rfq.pricingBasis)}
              </span>
              <span className="badge badge-slate">
                Strategy: {rfq.sourcingStrategyType}
                {rfq.sourcingStrategyConfirmed ? " · CONFIRMED" : " · UNCONFIRMED"}
              </span>
            </div>
          </div>

          <FounderCommercialControls
            rfqId={rfq.id}
            recommendedCompanyId={rfq.recommendedCompanyId}
            selectedCompanyId={rfq.selectedCompanyId}
            selectionReason={rfq.companySelectionReason}
            companies={operationalCompanies}
            pricingBasis={rfq.pricingBasis}
            eligibilityVerdict={eligibilityVerdict}
            eligibilityWarningAccepted={Boolean(rfq.eligibilityWarningAcceptedAt)}
            commercialsApproved={Boolean(rfq.commercialsApprovedAt)}
            readiness={readiness}
          />

          {rfq.status !== "FOUNDER_REVIEW" && (
            <form action={prepareFounderReviewAction} className="panel panel-body">
              <input type="hidden" name="rfqId" value={rfq.id} />
              <p className="mb-3 text-sm text-[var(--fg-muted)]">
                Generate compliance checklist, create Bid record, mark supplier
                drafts as PENDING_EMAIL_INTEGRATION, and open Founder review.
                Does not send email or submit the tender.
              </p>
              <button type="submit" className="btn btn-primary">
                Prepare Founder review pack
              </button>
            </form>
          )}
        </div>
      )}

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
                <FactRow
                  label="Commercial gate"
                  value={rfq.profitabilityGate}
                />
                <FactRow
                  label="Line items"
                  value={`${rfq.lineItems.length} · suppliers ${
                    new Set([
                      ...rfq.quotes.map((q) => q.supplierId),
                      ...rfq.enquiries.map((e) => e.supplierId),
                    ]).size
                  } · quotes/evidence ${rfq.quotes.length}`}
                />
                {selectedPricing ? (
                  <>
                    <FactRow
                      label="Landed cost"
                      value={formatZar(Number(selectedPricing.landedCost))}
                    />
                    <FactRow
                      label="Proposed bid"
                      value={formatZar(Number(selectedPricing.totalQuotation))}
                    />
                    <FactRow
                      label="Gross profit"
                      value={formatZar(Number(selectedPricing.grossProfit))}
                    />
                    <FactRow
                      label="Gross margin"
                      value={formatPercent(Number(selectedPricing.grossMarginPercent))}
                    />
                    <FactRow
                      label="Cash required"
                      value={formatZar(
                        Number(
                          selectedPricing.upfrontCashRequired ??
                            selectedPricing.workingCapitalRequired,
                        ),
                      )}
                    />
                    <FactRow
                      label="Evidence"
                      value={selectedPricing.evidenceQuality ?? "—"}
                    />
                    {selectedPricing.vatRegisteredSnapshot != null && (
                      <VatBadge
                        vatRegistered={selectedPricing.vatRegisteredSnapshot}
                      />
                    )}
                  </>
                ) : (
                  <p className="muted">
                    No pricing scenario yet — extract documents, source suppliers,
                    then enter quote or labelled price evidence.
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
            <div className="panel-header">
              What we need — line items (verification required)
            </div>
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
                  <th>Verification</th>
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
                      {li.extractionMethod && (
                        <div className="muted mt-1 text-[10px]">
                          {li.extractionMethod}
                          {li.extractionConfidence != null
                            ? ` · conf ${li.extractionConfidence}`
                            : ""}
                          {li.sourceSection ? ` · ${li.sourceSection}` : ""}
                        </div>
                      )}
                    </td>
                    <td className="text-xs">{li.specification ?? "—"}</td>
                    <td className="text-xs">{li.brandRequirement ?? "—"}</td>
                    <td className="mono">{Number(li.quantity)}</td>
                    <td>{li.unit}</td>
                    <td>{li.equivalentAllowed ? "Yes" : "No"}</td>
                    <td>
                      <span
                        className={`badge ${
                          li.verificationStatus === "VERIFIED"
                            ? "badge-green"
                            : li.verificationStatus === "CORRECTED"
                              ? "badge-amber"
                              : "badge-slate"
                        }`}
                      >
                        {li.verificationStatus}
                      </span>
                    </td>
                  </tr>
                ))}
                {rfq.lineItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="muted py-6 text-center">
                      No line items captured — download and extract source documents.
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
          <div className="panel-header">Source documents (hash-cached)</div>
          <table className="ops-table">
            <thead>
              <tr>
                <th>File</th>
                <th>State</th>
                <th>Hash</th>
                <th>Retrieved</th>
                <th>Pages</th>
                <th>Source URL</th>
              </tr>
            </thead>
            <tbody>
              {rfq.documents.map((doc) => (
                <tr key={doc.id}>
                  <td className="mono text-xs">{doc.fileName}</td>
                  <td>
                    <span className="badge badge-slate">{doc.processingState}</span>
                  </td>
                  <td className="mono text-[11px]">
                    {doc.contentHash ? `${doc.contentHash.slice(0, 12)}…` : "—"}
                  </td>
                  <td className="text-xs">{formatDateTime(doc.retrievedAt, rfq.timezone)}</td>
                  <td className="mono">{doc.pageCount ?? "—"}</td>
                  <td className="text-xs break-all">{doc.sourceUrl ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "suppliers" && (
        <div className="space-y-3">
          <div className="panel">
            <div className="panel-header">Discovered suppliers</div>
            <ul className="panel-body space-y-2 text-sm">
              {[
                ...new Map(
                  [
                    ...rfq.quotes.map((q) => q.supplier),
                    ...rfq.enquiries.map((e) => e.supplier),
                  ].map((s) => [s.id, s]),
                ).values(),
              ].map((s) => (
                <li
                  key={s.id}
                  className="border border-[var(--border)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/suppliers/${s.id}`}
                      className="font-semibold text-[var(--accent)] hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="badge badge-slate">
                      {s.supplierType ?? "supplier"}
                    </span>
                  </div>
                  <div className="muted mt-1 text-xs">
                    {s.discoverySource ?? "—"} · {s.verificationStatus}
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <div className="panel-header">Supplier RFQ drafts (NOT SENT)</div>
            <ul className="panel-body space-y-3 text-sm">
              {rfq.enquiries.map((e) => (
                <li key={e.id} className="border border-[var(--border)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{e.supplier.name}</span>
                    <span className="badge badge-amber">{e.deliveryState}</span>
                  </div>
                  <div className="mt-1 text-xs font-medium">{e.subject}</div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap bg-[#f8fafc] p-2 text-[11px]">
                    {e.body}
                  </pre>
                </li>
              ))}
              {rfq.enquiries.length === 0 && (
                <li className="muted">No enquiry drafts yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {tab === "quotes" && (
        <div className="space-y-3">
          <QuoteCaptureForm
            rfqId={rfq.id}
            lines={rfq.lineItems.map((l) => ({
              id: l.id,
              lineNumber: l.lineNumber,
              description: l.description,
              quantity: Number(l.quantity),
              unit: l.unit,
              brandRequirement: l.brandRequirement,
            }))}
            suppliers={operationalSuppliers.map((s) => ({
              id: s.id,
              name: s.name,
              email: s.email,
            }))}
            quotes={rfq.quotes.map((q) => ({
              id: q.id,
              supplierName: q.supplier.name,
              evidenceType: q.evidenceType,
              verificationState: q.verificationState,
              quoteReference: q.quoteReference,
              isComplete: q.isComplete,
              deliveryKnown: q.deliveryKnown,
              subtotal: q.subtotal != null ? Number(q.subtotal) : null,
              validUntil: q.validUntil,
            }))}
          />
          <div className="panel overflow-x-auto">
            <div className="panel-header">Mapped offers (all evidence types)</div>
            <table className="ops-table">
              <thead>
                <tr>
                  <th>RFQ item</th>
                  <th>Qty</th>
                  <th>Spec</th>
                  <th>Offer</th>
                  <th>Unit</th>
                  <th>Total</th>
                  <th>Match</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rfq.lineItems.map((li) => {
                  const offers = rfq.quotes.flatMap((q) =>
                    q.lineItems
                      .filter((ql) => ql.rfqLineItemId === li.id)
                      .map((ql) => ({ q, ql })),
                  );
                  if (offers.length === 0) {
                    return (
                      <tr key={li.id}>
                        <td>{li.description}</td>
                        <td className="mono">{Number(li.quantity)}</td>
                        <td className="text-xs">{li.specification ?? "—"}</td>
                        <td colSpan={5} className="muted">
                          No mapped offers
                        </td>
                      </tr>
                    );
                  }
                  return offers.map(({ q, ql }, idx) => (
                    <tr key={`${li.id}-${ql.id}`}>
                      {idx === 0 ? (
                        <>
                          <td rowSpan={offers.length}>{li.description}</td>
                          <td rowSpan={offers.length} className="mono">
                            {Number(li.quantity)}
                          </td>
                          <td rowSpan={offers.length} className="text-xs">
                            {li.specification ?? "—"}
                          </td>
                        </>
                      ) : null}
                      <td className="text-xs">{q.supplier.name}</td>
                      <td className="mono">
                        {ql.priceKnown && ql.unitCost != null
                          ? formatZar(Number(ql.unitCost))
                          : "UNKNOWN"}
                      </td>
                      <td className="mono">
                        {ql.lineTotal != null
                          ? formatZar(Number(ql.lineTotal))
                          : "UNKNOWN"}
                      </td>
                      <td>
                        <span className="badge badge-slate">{ql.matchState}</span>
                      </td>
                      <td>
                        <EvidenceBadge type={q.evidenceType} />
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>

          {rfq.quotes.map((q) => (
            <div key={q.id} className="panel overflow-x-auto">
              <div className="panel-header">
                <span>
                  {q.supplier.name}
                  {q.quoteReference ? ` · ${q.quoteReference}` : ""}
                </span>
                <EvidenceBadge type={q.evidenceType} />
              </div>
              <div className="panel-body grid gap-2 text-sm md:grid-cols-4">
                <Fact
                  label="Delivery"
                  value={
                    q.deliveryKnown && q.deliveryCost != null
                      ? formatZar(Number(q.deliveryCost))
                      : "UNKNOWN"
                  }
                />
                <Fact
                  label="VAT on quote"
                  value={
                    q.vatKnown
                      ? q.vatIncluded
                        ? "Inclusive"
                        : "Exclusive"
                      : "UNKNOWN"
                  }
                />
                <Fact
                  label="Lead time"
                  value={q.leadTimeDays != null ? `${q.leadTimeDays} days` : "—"}
                />
                <Fact label="Verification" value={q.verificationState} />
              </div>
              {q.notes && (
                <div className="panel-body muted text-xs">Notes: {q.notes}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === "comparison" && (
        <SupplierComparisonPanel
          rfqId={rfq.id}
          rows={comparisonRows}
          summaries={quoteSummaries}
          recommendation={sourcingRecommendation}
          strategyConfirmed={rfq.sourcingStrategyConfirmed}
          pricingBasis={rfq.pricingBasis}
        />
      )}

      {tab === "pricing" && (
        <div className="space-y-3">
          <div className="panel panel-body text-sm">
            <span
              className={`badge ${
                rfq.pricingBasis === "VERIFIED_SUPPLIER"
                  ? "badge-green"
                  : "badge-amber"
              }`}
            >
              {pricingEvidenceLabel(rfq.pricingBasis)}
            </span>
            <span className="muted ml-2 text-xs">
              Markup ≠ margin. Historical scenarios are retained when pricing is
              refreshed.
            </span>
          </div>
          <CommercialPanel
            scenario={
              rfq.pricingScenarios.find((s) => s.isSelected) ??
              rfq.pricingScenarios[0] ??
              null
            }
            companyVatRegistered={rfq.selectedCompany?.vatRegistered}
          />
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
                <th>Evidence source</th>
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
                  <td className="muted text-xs">
                    {item.evidenceSource ?? "—"}
                  </td>
                </tr>
              ))}
              {rfq.complianceItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted py-6 text-center">
                    No compliance items — run Prepare Founder review pack.
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
