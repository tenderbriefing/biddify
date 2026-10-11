export type DeadlineWarning =
  | "CLOSED"
  | "2h"
  | "6h"
  | "12h"
  | "24h"
  | "48h"
  | "72h"
  | "7d"
  | "OK";

export type DeadlineView = {
  closingAt: Date;
  timezone: string;
  msRemaining: number;
  hoursRemaining: number;
  isClosed: boolean;
  warning: DeadlineWarning;
  label: string;
};

const WARNING_THRESHOLDS: { ms: number; warning: DeadlineWarning }[] = [
  { ms: 0, warning: "CLOSED" },
  { ms: 2 * 60 * 60 * 1000, warning: "2h" },
  { ms: 6 * 60 * 60 * 1000, warning: "6h" },
  { ms: 12 * 60 * 60 * 1000, warning: "12h" },
  { ms: 24 * 60 * 60 * 1000, warning: "24h" },
  { ms: 48 * 60 * 60 * 1000, warning: "48h" },
  { ms: 72 * 60 * 60 * 1000, warning: "72h" },
  { ms: 7 * 24 * 60 * 60 * 1000, warning: "7d" },
];

export function evaluateDeadline(
  closingAt: Date,
  now: Date = new Date(),
  timezone: string = "Africa/Johannesburg",
): DeadlineView {
  const msRemaining = closingAt.getTime() - now.getTime();
  const isClosed = msRemaining <= 0;
  const hoursRemaining = msRemaining / (60 * 60 * 1000);

  let warning: DeadlineWarning = "OK";
  if (isClosed) {
    warning = "CLOSED";
  } else {
    for (const threshold of WARNING_THRESHOLDS) {
      if (threshold.warning === "CLOSED") continue;
      if (msRemaining <= threshold.ms) {
        warning = threshold.warning;
        break;
      }
    }
  }

  return {
    closingAt,
    timezone,
    msRemaining,
    hoursRemaining,
    isClosed,
    warning,
    label: formatRemaining(msRemaining),
  };
}

export function canSubmit(
  closingAt: Date,
  now: Date = new Date(),
  founderLateOverride: boolean = false,
): { allowed: boolean; reason: string } {
  const view = evaluateDeadline(closingAt, now);
  if (!view.isClosed) {
    return { allowed: true, reason: "Within deadline" };
  }
  if (founderLateOverride) {
    return {
      allowed: true,
      reason: "Founder override — late submission permitted with evidence",
    };
  }
  return {
    allowed: false,
    reason: "Deadline passed — Founder override required",
  };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return "CLOSED";
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
