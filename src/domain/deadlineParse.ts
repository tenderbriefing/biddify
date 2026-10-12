/**
 * Deadline parsing for procurement sources.
 * Never invent missing times. Date-only → closingTimeKnown=false.
 * Default timezone Africa/Johannesburg unless evidence says otherwise.
 */

export type ParsedDeadline = {
  /** Instant used for countdown (date-only uses 00:00 in timezone, flagged unknown). */
  closingAt: Date;
  closingTimeKnown: boolean;
  timezone: string;
  sourceRaw: string | null;
  warning?: string;
};

const DEFAULT_TZ = "Africa/Johannesburg";

/** Parse ISO / date-only closing values from OCDS or similar. */
export function parseClosingDeadline(
  raw: string | Date | null | undefined,
  timezone: string = DEFAULT_TZ,
): ParsedDeadline | null {
  if (raw == null || raw === "") {
    return null;
  }

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return {
      closingAt: raw,
      closingTimeKnown: true,
      timezone,
      sourceRaw: raw.toISOString(),
    };
  }

  const trimmed = raw.trim();

  // Date-only: YYYY-MM-DD — do NOT invent 23:59
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const closingAt = wallTimeToUtc(trimmed, 0, 0, 0, timezone);
    return {
      closingAt,
      closingTimeKnown: false,
      timezone,
      sourceRaw: trimmed,
      warning: "Closing time UNKNOWN — source provided date only",
    };
  }

  // ISO with time (possibly Z / offset)
  const hasTime = /T\d{2}:\d{2}/.test(trimmed);
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (!hasTime) {
    const ymd = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      return parseClosingDeadline(ymd, timezone);
    }
  }

  return {
    closingAt: parsed,
    closingTimeKnown: hasTime,
    timezone,
    sourceRaw: trimmed,
    warning: hasTime ? undefined : "Closing time UNKNOWN",
  };
}

export function parseOptionalInstant(
  raw: string | Date | null | undefined,
): Date | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Convert a civil date + wall clock in a named timezone to a UTC Date.
 * Supports Africa/Johannesburg (fixed UTC+2, no DST).
 */
function wallTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  second: number,
  timezone: string,
): Date {
  if (timezone !== "Africa/Johannesburg" && timezone !== "UTC") {
    // Phase 2: SA procurement default. Other zones fall back to treating as UTC wall.
    // Documented for PostgreSQL/production hardening.
  }
  const [y, m, d] = ymd.split("-").map(Number);
  if (timezone === "Africa/Johannesburg") {
    // SAST = UTC+2 year-round
    return new Date(Date.UTC(y, m - 1, d, hour - 2, minute, second));
  }
  return new Date(Date.UTC(y, m - 1, d, hour, minute, second));
}

export function formatClosingDisplay(
  closingAt: Date,
  closingTimeKnown: boolean,
  timezone: string = DEFAULT_TZ,
): string {
  const datePart = new Intl.DateTimeFormat("en-ZA", {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(closingAt);

  if (!closingTimeKnown) {
    return `${datePart} · time UNKNOWN`;
  }

  const timePart = new Intl.DateTimeFormat("en-ZA", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(closingAt);

  return `${datePart} ${timePart} (${timezone})`;
}
