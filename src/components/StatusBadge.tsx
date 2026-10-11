import type { PipelineStatus } from "@/domain/status";
import type { ProfitabilityGate } from "@/domain/profitability";
import type { DeadlineWarning } from "@/domain/deadlines";

const statusClass: Partial<Record<PipelineStatus, string>> = {
  FOUNDER_REVIEW: "badge-amber",
  APPROVED: "badge-green",
  SUBMISSION_AUTHORISED: "badge-green",
  SUBMITTED: "badge-green",
  AWARDED: "badge-green",
  LOST: "badge-red",
  NO_BID: "badge-slate",
  CANCELLED: "badge-slate",
  COMPLIANCE: "badge-amber",
  SOURCING: "badge-amber",
  AWAITING_SUPPLIERS: "badge-amber",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = statusClass[status as PipelineStatus] ?? "badge-slate";
  return <span className={`badge ${cls}`}>{status.replaceAll("_", " ")}</span>;
}

export function GateBadge({ gate }: { gate: ProfitabilityGate | string }) {
  const cls =
    gate === "GREEN"
      ? "badge-green"
      : gate === "AMBER"
        ? "badge-amber"
        : gate === "RED"
          ? "badge-red"
          : "badge-slate";
  return <span className={`badge ${cls}`}>{gate}</span>;
}

export function DeadlineBadge({ warning }: { warning: DeadlineWarning }) {
  const urgent = ["CLOSED", "2h", "6h", "12h", "24h"].includes(warning);
  const soon = ["48h", "72h"].includes(warning);
  const cls = urgent ? "badge-red" : soon ? "badge-amber" : "badge-slate";
  return <span className={`badge ${cls}`}>{warning}</span>;
}

export function DemoBadge() {
  return <span className="badge badge-demo">DEMO</span>;
}

export function VatBadge({ vatRegistered }: { vatRegistered: boolean }) {
  return (
    <span className={`badge ${vatRegistered ? "badge-green" : "badge-amber"}`}>
      VAT Registered: {vatRegistered ? "YES" : "NO"}
    </span>
  );
}
