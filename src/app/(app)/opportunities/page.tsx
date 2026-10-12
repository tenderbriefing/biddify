import Link from "next/link";
import { prisma } from "@/lib/db";
import { evaluateDeadline } from "@/domain/deadlines";
import { formatClosingDisplay } from "@/domain/deadlineParse";
import { formatDateTime } from "@/lib/format";
import {
  DeadlineBadge,
  DemoBadge,
  GateBadge,
  StatusBadge,
} from "@/components/StatusBadge";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "eligible", label: "Eligible" },
  { key: "review", label: "Review required" },
  { key: "bidding", label: "Bidding" },
  { key: "not_eligible", label: "Not eligible" },
  { key: "closing_soon", label: "Closing soon" },
  { key: "supply", label: "Supply & Deliver" },
  { key: "services", label: "Services" },
  { key: "works", label: "Works" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function deadlineBand(hoursRemaining: number, isClosed: boolean): string {
  if (isClosed) return "CLOSED";
  if (hoursRemaining <= 24) return "Critical (<24h)";
  if (hoursRemaining <= 72) return "Urgent (1–3d)";
  if (hoursRemaining <= 168) return "Upcoming (4–7d)";
  return "Pipeline (>7d)";
}

export default async function OpportunityInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const sp = await searchParams;
  const filter = (FILTERS.some((f) => f.key === sp.filter)
    ? sp.filter
    : "supply") as FilterKey;
  const q = sp.q?.trim();
  const now = new Date();

  const rfqs = await prisma.rfq.findMany({
    where: {
      isRealSource: true,
      isDemo: false,
      ...(q
        ? {
            OR: [
              { internalId: { contains: q } },
              { title: { contains: q } },
              { buyer: { contains: q } },
              { tenderNumber: { contains: q } },
              { province: { contains: q } },
            ],
          }
        : {}),
    },
    include: {
      selectedCompany: true,
      documents: { select: { id: true } },
    },
    orderBy: { closingAt: "asc" },
  });

  const filtered = rfqs.filter((rfq) => {
    const deadline = evaluateDeadline(rfq.closingAt, now, rfq.timezone);
    switch (filter) {
      case "new":
        return ["NEW", "REVIEW"].includes(rfq.status);
      case "eligible":
        return (
          rfq.qualificationGate === "GREEN" ||
          (rfq.selectedCompanyId != null && rfq.qualificationGate !== "RED")
        );
      case "review":
        return (
          rfq.qualificationGate === "AMBER" ||
          rfq.nextAction === "MANUAL_REVIEW" ||
          rfq.status === "REVIEW"
        );
      case "bidding":
        return [
          "QUALIFIED",
          "SOURCING",
          "AWAITING_SUPPLIERS",
          "PRICING",
          "COMPLIANCE",
          "FOUNDER_REVIEW",
          "APPROVED",
          "SUBMISSION_AUTHORISED",
        ].includes(rfq.status);
      case "not_eligible":
        return rfq.qualificationGate === "RED" || rfq.status === "NO_BID";
      case "closing_soon":
        return !deadline.isClosed && deadline.hoursRemaining <= 72;
      case "supply":
        return (
          rfq.classification === "SUPPLY_AND_DELIVER" ||
          /supply/i.test(rfq.category ?? "") ||
          /supply/i.test(rfq.title)
        );
      case "services":
        return (
          rfq.classification === "SERVICES" || /service/i.test(rfq.category ?? "")
        );
      case "works":
        return (
          rfq.classification === "CONSTRUCTION" ||
          /construction|works/i.test(rfq.category ?? "")
        );
      default:
        return true;
    }
  });

  // Prefer Supply & Deliver ordering within filter
  filtered.sort((a, b) => {
    const aSupply = a.classification === "SUPPLY_AND_DELIVER" ? 0 : 1;
    const bSupply = b.classification === "SUPPLY_AND_DELIVER" ? 0 : 1;
    if (aSupply !== bSupply) return aSupply - bSupply;
    return a.closingAt.getTime() - b.closingAt.getTime();
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Opportunity Inbox</h1>
          <p className="muted mt-1">
            Real eTenders opportunities. Supply &amp; Deliver prioritised. Closing
            priority uses closing date/time — never publication date.
          </p>
        </div>
        <DemoBadge />
      </div>

      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/opportunities?filter=${f.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-sm px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.04em] ${
              filter === f.key
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--bg-muted)] text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <form className="panel panel-body flex flex-wrap items-end gap-3">
        <input type="hidden" name="filter" value={filter} />
        <div className="field min-w-[240px] flex-1">
          <label htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Tender number, buyer, title…"
          />
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      <div className="panel overflow-x-auto">
        <table className="ops-table">
          <thead>
            <tr>
              <th>Tender / RFQ</th>
              <th>Buyer</th>
              <th>Title</th>
              <th>Province</th>
              <th>Published</th>
              <th>Briefing</th>
              <th>Closing</th>
              <th>Remaining</th>
              <th>Band</th>
              <th>Class</th>
              <th>Source</th>
              <th>Docs</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((rfq) => {
              const deadline = evaluateDeadline(
                rfq.closingAt,
                now,
                rfq.timezone,
              );
              return (
                <tr key={rfq.id}>
                  <td>
                    <Link
                      href={`/rfqs/${rfq.id}?tab=decision`}
                      className="mono font-semibold text-[var(--accent)] hover:underline"
                    >
                      {rfq.internalId}
                    </Link>
                    <div className="muted text-xs">
                      {rfq.tenderNumber ?? rfq.sourceOpportunityId}
                    </div>
                  </td>
                  <td className="text-sm">{rfq.buyer}</td>
                  <td className="max-w-[280px] text-sm">
                    <div className="font-medium leading-snug">{rfq.title}</div>
                    {rfq.description && (
                      <div className="muted mt-0.5 line-clamp-2 text-xs">
                        {rfq.description}
                      </div>
                    )}
                  </td>
                  <td className="text-xs">{rfq.province ?? "—"}</td>
                  <td className="text-xs">
                    {formatDateTime(
                      rfq.sourcePublishedAt ?? rfq.publicationDate,
                      rfq.timezone,
                    )}
                  </td>
                  <td className="text-xs">
                    {!rfq.briefingCompulsoryKnown
                      ? "Unknown"
                      : rfq.briefingCompulsory
                        ? `Compulsory${rfq.briefingDate ? ` · ${formatDateTime(rfq.briefingDate, rfq.timezone)}` : ""}`
                        : "Not compulsory"}
                  </td>
                  <td className="text-xs">
                    {formatClosingDisplay(
                      rfq.closingAt,
                      rfq.closingTimeKnown,
                      rfq.timezone,
                    )}
                  </td>
                  <td>
                    <DeadlineBadge warning={deadline.warning} />
                    <div className="mono mt-0.5 text-xs">{deadline.label}</div>
                  </td>
                  <td className="text-xs">
                    {deadlineBand(deadline.hoursRemaining, deadline.isClosed)}
                  </td>
                  <td className="text-xs">
                    {rfq.classification?.replaceAll("_", " ") ??
                      rfq.category ??
                      "—"}
                  </td>
                  <td className="text-xs">{rfq.source}</td>
                  <td className="mono text-xs">{rfq.documents.length}</td>
                  <td>
                    <StatusBadge status={rfq.status} />
                    <div className="mt-1">
                      <GateBadge gate={rfq.qualificationGate} />
                    </div>
                    {rfq.selectedCompany && (
                      <div className="muted mt-1 text-[10px]">
                        {rfq.selectedCompany.tradingName ??
                          rfq.selectedCompany.legalName}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="muted py-8 text-center">
                  No opportunities match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted text-xs">
        Showing {filtered.length} of {rfqs.length} real-source opportunities.
        Email transport remains PENDING_EMAIL_INTEGRATION.
      </p>
    </div>
  );
}
