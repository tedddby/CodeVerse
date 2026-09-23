/** Formatting helpers shared by panels, the loading experience and the OG image. */

const compactFormatter = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const integerFormatter = new Intl.NumberFormat("en");

/** 238421 -> "238.4K". */
export function formatCompact(value: number): string {
  return compactFormatter.format(value);
}

/** 12482 -> "12,482". */
export function formatInteger(value: number): string {
  return integerFormatter.format(Math.round(value));
}

/** 0.4812 -> "48%"; small non-zero shares render as "<1%". */
export function formatPercent(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 days ago", "last month". `now` is injectable for deterministic tests. */
export function formatRelativeTime(isoDate: string, now: number = Date.now()): string {
  const time = Date.parse(isoDate);
  if (Number.isNaN(time)) return "unknown";
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relativeFormatter.format(seconds, "second");
  if (abs < 3600) return relativeFormatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relativeFormatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 86_400 * 30) return relativeFormatter.format(Math.round(seconds / 86_400), "day");
  if (abs < 86_400 * 365) return relativeFormatter.format(Math.round(seconds / (86_400 * 30)), "month");
  return relativeFormatter.format(Math.round(seconds / (86_400 * 365)), "year");
}

const dateFormatter = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export function formatDate(isoDate: string): string {
  const time = Date.parse(isoDate);
  return Number.isNaN(time) ? "unknown" : dateFormatter.format(time);
}
