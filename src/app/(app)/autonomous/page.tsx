import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatZar } from "@/lib/format";

export default async function AutonomousOpsDashboardPage() {
  const [
    discovered,
    supplyAndDeliver,
    processing,
    autoQuoted,
    reviewRequired,
    unpriceable,
    ineligible,
    failed,
    readyQuotes,
    founderReview,
    exceptions,
    completedRuns,
    settings,
  ] = await Promise.all([
    prisma.rfq.count({ where: { autonomousState: { not: null } } }),
    prisma.rfq.count({
      where: {
        classification: "SUPPLY_AND_DELIVER",
        autonomousState: { not: null },
      },
    }),
    prisma.rfq.count({
      where: {
        autonomousState: {
          in: [
            "CLASSIFYING",
            "INGESTING_DOCUMENTS",
            "ANALYSING_REQUIREMENTS",
            "ELIGIBILITY_CHECK",
            "BOQ_EXTRACTION",
            "PRODUCT_RESEARCH",
            "PRODUCT_MATCHING",
            "PRICING",
            "QUOTATION_GENERATION",
            "COMPLIANCE_CHECK",
          ],
        },
      },
    }),
    prisma.rfq.count({ where: { autonomousOutcome: "AUTO_QUOTED" } }),
    prisma.rfq.count({ where: { autonomousOutcome: "REVIEW_REQUIRED" } }),
    prisma.rfq.count({ where: { autonomousOutcome: "UNPRICEABLE" } }),
    prisma.rfq.count({ where: { autonomousOutcome: "INELIGIBLE" } }),
    prisma.rfq.count({ where: { autonomousOutcome: "FAILED" } }),
    prisma.rfq.findMany({
      where: { autonomousOutcome: "AUTO_QUOTED" },
      orderBy: { autonomousCompletedAt: "desc" },
      take: 20,
      select: {
        id: true,
        internalId: true,
        title: true,
        buyer: true,
        autonomousConfidence: true,
        autonomousCompletedAt: true,
        autonomousQuotations: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { totalAmount: true, quotationNumber: true },
        },
      },
    }),
    prisma.rfq.findMany({
      where: {
        OR: [
          { autonomousOutcome: "REVIEW_REQUIRED" },
          { status: "FOUNDER_REVIEW", inFounderBidQueue: true },
        ],
      },
      orderBy: { closingAt: "asc" },
      take: 30,
      select: {
        id: true,
        internalId: true,
        title: true,
        buyer: true,
        closingAt: true,
        autonomousOutcome: true,
        autonomousFailureReason: true,
        autonomousRunJson: true,
        autonomousConfidence: true,
      },
    }),
    prisma.rfq.findMany({
      where: {
        autonomousOutcome: { in: ["UNPRICEABLE", "INELIGIBLE", "FAILED"] },
      },
      orderBy: { autonomousCompletedAt: "desc" },
      take: 30,
      select: {
        id: true,
        internalId: true,
        title: true,
        autonomousOutcome: true,
        autonomousFailureReason: true,
        autonomousRunJson: true,
      },
    }),
    prisma.rfq.findMany({
      where: {
        autonomousCompletedAt: { not: null },
        autonomousDurationMs: { not: null },
      },
      select: {
        autonomousDurationMs: true,
        autonomousRunJson: true,
        autonomousConfidence: true,
        autonomousQuotations: {
          take: 1,
          select: { totalAmount: true, internalSnapshotJson: true },
        },
      },
    }),
    prisma.systemSettings.findUnique({ where: { id: "default" } }),
  ]);

  const avgMs =
    completedRuns.length === 0
      ? null
      : completedRuns.reduce((s, r) => s + (r.autonomousDurationMs ?? 0), 0) /
        completedRuns.length;

  let markupSum = 0;
  let markupN = 0;
  let quoteValue = 0;
  let grossProfit = 0;
  const confidenceBuckets = { high: 0, mid: 0, low: 0 };
  const reasonCounts = new Map<string, number>();

  for (const r of completedRuns) {
    const conf = r.autonomousConfidence ?? 0;
    if (conf >= 0.75) confidenceBuckets.high += 1;
    else if (conf >= 0.5) confidenceBuckets.mid += 1;
    else confidenceBuckets.low += 1;

    const q = r.autonomousQuotations[0];
    if (q) {
      quoteValue += Number(q.totalAmount);
      if (q.internalSnapshotJson) {
        try {
          const snap = JSON.parse(q.internalSnapshotJson) as {
            markup?: { markupPercent?: number };
            commercial?: { grossProfit?: number; markupPercent?: number };
          };
          const mp =
            snap.commercial?.markupPercent ?? snap.markup?.markupPercent;
          if (mp != null) {
            markupSum += mp;
            markupN += 1;
          }
          if (snap.commercial?.grossProfit != null) {
            grossProfit += snap.commercial.grossProfit;
          }
        } catch {
          /* ignore */
        }
      }
    }
  }

  for (const r of [...founderReview, ...exceptions]) {
    try {
      const run = r.autonomousRunJson
        ? (JSON.parse(r.autonomousRunJson) as { reasons?: string[] })
        : null;
      for (const reason of run?.reasons ?? []) {
        const key = reason.slice(0, 80);
        reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
      }
    } catch {
      /* ignore */
    }
    if (r.autonomousFailureReason) {
      const key = r.autonomousFailureReason.slice(0, 80);
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }
  }

  const topReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const prepOn = settings?.autonomousPrepEnabled !== false;
  const submitOff = settings?.autonomousSubmissionEnabled !== true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          Autonomous RFQ Engine
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Prep autonomy {prepOn ? "ON" : "OFF"} · Submission autonomy{" "}
          {submitOff ? "OFF" : "ON (blocked)"} · Manual supplier quotes remain
          fallback
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Discovered (touched)", discovered],
          ["Supply & Deliver", supplyAndDeliver],
          ["Currently processing", processing],
          ["AUTO_QUOTED", autoQuoted],
          ["REVIEW_REQUIRED", reviewRequired],
          ["UNPRICEABLE", unpriceable],
          ["INELIGIBLE", ineligible],
          ["FAILED", failed],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="border border-[var(--border)] bg-white px-4 py-3"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-muted)]">
              {label}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Avg processing time"
          value={avgMs == null ? "—" : `${(avgMs / 1000).toFixed(1)}s`}
        />
        <Metric
          label="Avg markup"
          value={markupN ? `${(markupSum / markupN).toFixed(1)}%` : "—"}
        />
        <Metric
          label="Est. quotation value"
          value={formatZar(quoteValue)}
        />
        <Metric
          label="Est. gross profit"
          value={formatZar(grossProfit)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="border border-[var(--border)] bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em]">
            Pricing confidence distribution
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            <li>High (≥0.75): {confidenceBuckets.high}</li>
            <li>Mid (0.50–0.74): {confidenceBuckets.mid}</li>
            <li>Low (&lt;0.50): {confidenceBuckets.low}</li>
          </ul>
        </section>
        <section className="border border-[var(--border)] bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.06em]">
            Top failure / review reasons
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {topReasons.length === 0 && (
              <li className="text-[var(--fg-muted)]">No reasons yet</li>
            )}
            {topReasons.map(([reason, count]) => (
              <li key={reason}>
                <span className="tabular-nums font-medium">{count}×</span>{" "}
                {reason}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <Queue
        title="Ready quotations"
        rows={readyQuotes.map((r) => ({
          id: r.id,
          internalId: r.internalId,
          title: r.title,
          meta: r.autonomousQuotations[0]
            ? `${r.autonomousQuotations[0].quotationNumber} · ${formatZar(Number(r.autonomousQuotations[0].totalAmount))}`
            : `confidence ${r.autonomousConfidence?.toFixed(2) ?? "—"}`,
        }))}
      />
      <Queue
        title="Founder review"
        rows={founderReview.map((r) => ({
          id: r.id,
          internalId: r.internalId,
          title: r.title,
          meta: `${r.autonomousOutcome ?? "—"} · conf ${r.autonomousConfidence?.toFixed(2) ?? "—"}`,
        }))}
      />
      <Queue
        title="Exceptions"
        rows={exceptions.map((r) => ({
          id: r.id,
          internalId: r.internalId,
          title: r.title,
          meta: `${r.autonomousOutcome}${r.autonomousFailureReason ? ` · ${r.autonomousFailureReason.slice(0, 60)}` : ""}`,
        }))}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--border)] bg-white px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-muted)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Queue({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ id: string; internalId: string; title: string; meta: string }>;
}) {
  return (
    <section className="border border-[var(--border)] bg-white">
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold uppercase tracking-[0.06em]">
        {title} ({rows.length})
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {rows.length === 0 && (
          <li className="px-4 py-3 text-sm text-[var(--fg-muted)]">Empty</li>
        )}
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <Link
              href={`/rfqs/${r.id}`}
              className="font-medium text-[var(--accent)] hover:underline"
            >
              {r.internalId}
            </Link>
            <span className="text-[var(--fg-muted)]"> — {r.title}</span>
            <div className="mt-0.5 text-xs text-[var(--fg-muted)]">{r.meta}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
