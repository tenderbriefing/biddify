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
    researchObs,
    lineCandidates,
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
        webResearchCoverage: true,
        liveResearchMetricsJson: true,
        autonomousQuotations: {
          take: 1,
          select: { totalAmount: true, internalSnapshotJson: true },
        },
      },
    }),
    prisma.systemSettings.findUnique({ where: { id: "default" } }),
    prisma.researchObservation.groupBy({
      by: ["eventType"],
      _count: true,
    }),
    prisma.productResearchCandidate.findMany({
      where: { researchProvider: { not: null } },
      select: {
        rfqLineItemId: true,
        researchProvider: true,
        priceKnown: true,
        selected: true,
      },
    }),
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

  const processed = completedRuns.length;
  const totalDurationMs = completedRuns.reduce(
    (s, r) => s + (r.autonomousDurationMs ?? 0),
    0,
  );
  const processedPerHour =
    totalDurationMs > 0
      ? (processed / (totalDurationMs / 3_600_000)).toFixed(1)
      : "—";

  const outcomeTotal =
    autoQuoted + reviewRequired + unpriceable + ineligible + failed || 1;
  const pct = (n: number) => `${((n / outcomeTotal) * 100).toFixed(0)}%`;

  const coverageVals = completedRuns
    .map((r) => (r as { webResearchCoverage?: number | null }).webResearchCoverage)
    .filter((v): v is number => v != null);
  // Re-query coverage from stored field via completedRuns select — extend below if missing
  void coverageVals;

  const linesResearched = new Set(lineCandidates.map((c) => c.rfqLineItemId)).size;
  const liveLines = new Set(
    lineCandidates
      .filter((c) => c.researchProvider === "live-web" && c.priceKnown)
      .map((c) => c.rfqLineItemId),
  ).size;
  const webCoveragePct =
    linesResearched > 0
      ? `${((liveLines / linesResearched) * 100).toFixed(0)}%`
      : "—";

  const byLine = new Map<string, number>();
  for (const c of lineCandidates) {
    byLine.set(c.rfqLineItemId, (byLine.get(c.rfqLineItemId) ?? 0) + 1);
  }
  const sourceCounts = [...byLine.values()];
  const multiSourceLines = sourceCounts.filter((n) => n >= 2).length;
  const singleSourceLines = sourceCounts.filter((n) => n === 1).length;
  const sourceDenom = sourceCounts.length || 1;

  const researchFailureReasons = researchObs
    .filter((g) =>
      /FAILED|REJECTED|BLOCKED|NOT_FOUND/i.test(g.eventType),
    )
    .map((g) => ({ reason: g.eventType, count: g._count }));

  const avgResearchTime =
    completedRuns.length === 0
      ? null
      : (() => {
          let total = 0;
          let n = 0;
          for (const r of completedRuns as Array<{
            liveResearchMetricsJson?: string | null;
          }>) {
            if (!r.liveResearchMetricsJson) continue;
            try {
              const m = JSON.parse(r.liveResearchMetricsJson) as {
                metricsByLine?: Record<string, { durationMs?: number }>;
              };
              for (const line of Object.values(m.metricsByLine ?? {})) {
                total += line.durationMs ?? 0;
                n += 1;
              }
            } catch {
              /* ignore */
            }
          }
          return n ? total / n : null;
        })();

  const integrityAgg = {
    qty: 0,
    pack: 0,
    basis: 0,
    extreme: 0,
    pass: 0,
    n: 0,
  };
  const optAgg = {
    n: 0,
    lines: 0,
    candidates: 0,
    lines3: 0,
    exact: 0,
    ambiguous: 0,
    optimized: 0,
    single: 0,
    split: 0,
    stockBlocked: 0,
    deliveryBlocked: 0,
    integrityBlocked: 0,
    varianceInv: 0,
    varianceResolved: 0,
    varianceUnresolved: 0,
    savings: 0,
  };
  for (const r of completedRuns) {
    if (!r.autonomousRunJson) continue;
    try {
      const run = JSON.parse(r.autonomousRunJson) as {
        artifacts?: {
          integrityMetrics?: {
            QUANTITY_RECONCILIATION_RATE?: number;
            PACK_SIZE_RESOLUTION_RATE?: number;
            PRICE_BASIS_RESOLUTION_RATE?: number;
            EXTREME_VARIANCE_RATE?: number;
            COMMERCIAL_INTEGRITY_PASS_RATE?: number;
          };
          optimizerMetrics?: {
            linesResearched?: number;
            totalCandidates?: number;
            linesWithAtLeast3?: number;
            exactOrEquivalent?: number;
            ambiguousMatches?: number;
            linesOptimized?: number;
            singleSupplierStrategies?: number;
            splitSupplierStrategies?: number;
            stockBlocked?: number;
            deliveryBlocked?: number;
            integrityBlocked?: number;
            extremeVarianceInvestigations?: number;
            varianceResolved?: boolean;
            varianceUnresolved?: boolean;
            potentialSavingsVsFirstValid?: number;
            procurementSavingsIdentified?: number;
          };
        };
      };
      const m = run.artifacts?.integrityMetrics;
      if (m) {
        integrityAgg.n += 1;
        integrityAgg.qty += m.QUANTITY_RECONCILIATION_RATE ?? 0;
        integrityAgg.pack += m.PACK_SIZE_RESOLUTION_RATE ?? 0;
        integrityAgg.basis += m.PRICE_BASIS_RESOLUTION_RATE ?? 0;
        integrityAgg.extreme += m.EXTREME_VARIANCE_RATE ?? 0;
        integrityAgg.pass += m.COMMERCIAL_INTEGRITY_PASS_RATE ?? 0;
      }
      const o = run.artifacts?.optimizerMetrics;
      if (o) {
        optAgg.n += 1;
        optAgg.lines += o.linesResearched ?? 0;
        optAgg.candidates += o.totalCandidates ?? 0;
        optAgg.lines3 += o.linesWithAtLeast3 ?? 0;
        optAgg.exact += o.exactOrEquivalent ?? 0;
        optAgg.ambiguous += o.ambiguousMatches ?? 0;
        optAgg.optimized += o.linesOptimized ?? 0;
        optAgg.single += o.singleSupplierStrategies ?? 0;
        optAgg.split += o.splitSupplierStrategies ?? 0;
        optAgg.stockBlocked += o.stockBlocked ?? 0;
        optAgg.deliveryBlocked += o.deliveryBlocked ?? 0;
        optAgg.integrityBlocked += o.integrityBlocked ?? 0;
        optAgg.varianceInv += o.extremeVarianceInvestigations ?? 0;
        if (o.varianceResolved) optAgg.varianceResolved += 1;
        if (o.varianceUnresolved) optAgg.varianceUnresolved += 1;
        optAgg.savings +=
          o.procurementSavingsIdentified ??
          o.potentialSavingsVsFirstValid ??
          0;
      }
    } catch {
      /* ignore */
    }
  }
  const integrityPct = (v: number) =>
    integrityAgg.n
      ? `${((v / integrityAgg.n) * 100).toFixed(0)}%`
      : "—";
  const avgCand =
    optAgg.lines > 0 ? (optAgg.candidates / optAgg.lines).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">
          Autonomous RFQ Engine
        </h1>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Prep autonomy {prepOn ? "ON" : "OFF"} · Live web research ON ·
          Commercial integrity gate ON · Procurement optimizer ON · Submission
          autonomy {submitOff ? "OFF" : "ON (blocked)"} · Manual supplier quotes
          remain fallback
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="RFQs processed" value={String(processed)} />
        <Metric label="RFQs processed/hour" value={String(processedPerHour)} />
        <Metric label="BOQ lines researched" value={String(linesResearched)} />
        <Metric
          label="Avg research time/line"
          value={
            avgResearchTime == null
              ? "—"
              : `${(avgResearchTime / 1000).toFixed(1)}s`
          }
        />
        <Metric
          label="Avg sources/line"
          value={
            sourceCounts.length
              ? (
                  sourceCounts.reduce((a, b) => a + b, 0) / sourceCounts.length
                ).toFixed(1)
              : "—"
          }
        />
        <Metric
          label="Single-source %"
          value={`${((singleSourceLines / sourceDenom) * 100).toFixed(0)}%`}
        />
        <Metric
          label="Multi-source %"
          value={`${((multiSourceLines / sourceDenom) * 100).toFixed(0)}%`}
        />
        <Metric label="WEB_RESEARCH_COVERAGE" value={webCoveragePct} />
        <Metric label="AUTO_QUOTED %" value={pct(autoQuoted)} />
        <Metric label="REVIEW_REQUIRED %" value={pct(reviewRequired)} />
        <Metric label="UNPRICEABLE %" value={pct(unpriceable)} />
        <Metric
          label="QUANTITY_RECONCILIATION_RATE"
          value={integrityPct(integrityAgg.qty)}
        />
        <Metric
          label="PACK_SIZE_RESOLUTION_RATE"
          value={integrityPct(integrityAgg.pack)}
        />
        <Metric
          label="PRICE_BASIS_RESOLUTION_RATE"
          value={integrityPct(integrityAgg.basis)}
        />
        <Metric
          label="EXTREME_VARIANCE_RATE"
          value={integrityPct(integrityAgg.extreme)}
        />
        <Metric
          label="COMMERCIAL_INTEGRITY_PASS_RATE"
          value={integrityPct(integrityAgg.pass)}
        />
        <Metric label="Tender lines researched" value={String(optAgg.lines || "—")} />
        <Metric label="Avg candidates/line" value={avgCand} />
        <Metric label="Lines with ≥3 candidates" value={String(optAgg.lines3 || "—")} />
        <Metric label="Exact/equivalent matches" value={String(optAgg.exact || "—")} />
        <Metric label="Ambiguous matches" value={String(optAgg.ambiguous || "—")} />
        <Metric label="Lines optimized" value={String(optAgg.optimized || "—")} />
        <Metric label="Single-supplier strategies" value={String(optAgg.single || "—")} />
        <Metric label="Split-supplier strategies" value={String(optAgg.split || "—")} />
        <Metric label="Stock-blocked candidates" value={String(optAgg.stockBlocked || "—")} />
        <Metric label="Delivery-blocked candidates" value={String(optAgg.deliveryBlocked || "—")} />
        <Metric label="Integrity-blocked candidates" value={String(optAgg.integrityBlocked || "—")} />
        <Metric label="Extreme variance investigations" value={String(optAgg.varianceInv || "—")} />
        <Metric label="Variance resolved" value={String(optAgg.varianceResolved || "—")} />
        <Metric label="Variance unresolved" value={String(optAgg.varianceUnresolved || "—")} />
        <Metric
          label="Procurement savings identified"
          value={optAgg.savings ? formatZar(optAgg.savings) : "—"}
        />
        <Metric
          label="Top research failures"
          value={
            researchFailureReasons[0]
              ? `${researchFailureReasons[0].reason} (${researchFailureReasons[0].count})`
              : "—"
          }
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
