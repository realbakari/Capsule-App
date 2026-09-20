import { sanitizeUntrusted } from "./untrusted.js";

export interface ReportedQuotaWindow {
  usedPercent: number;
  resetsAtMs: number;
}

/** A provider observation, not transcript accounting or a live balance. */
export interface ProviderSubscriptionUsage {
  providerId: "muse";
  observedAtMs: number;
  tier: string;
  window: ReportedQuotaWindow & { windowDurationMins: number };
  weekly: ReportedQuotaWindow;
}

export interface ProviderUsageSource {
  sessionId: string;
  title: string;
  report: ProviderSubscriptionUsage;
}

export interface ProviderUsageSnapshot {
  /** Empty means no running source has reported; it never means zero usage. */
  reports: ProviderUsageSource[];
  truncated: boolean;
}

export const MAX_PROVIDER_USAGE_SOURCES = 128;

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 8.64e15;
}

function readWindow(value: unknown): ReportedQuotaWindow | undefined {
  const row = record(value);
  if (typeof row.usedPercent !== "number" || !Number.isSafeInteger(row.usedPercent) || row.usedPercent < 0 || !validTimestamp(row.resetsAtMs)) return undefined;
  return { usedPercent: row.usedPercent, resetsAtMs: row.resetsAtMs };
}

/** Only the native adapter identifies the provider; untrusted payloads cannot. */
export function readMuseSubscriptionUsage(value: unknown): ProviderSubscriptionUsage | undefined {
  const row = record(value);
  const window = readWindow(row.window);
  const weekly = readWindow(row.weekly);
  const duration = record(row.window).windowDurationMins;
  if (!window || !weekly || !validTimestamp(row.observedAtMs) || typeof duration !== "number"
    || !Number.isSafeInteger(duration) || duration <= 0 || typeof row.tier !== "string") return undefined;
  // Strip terminal styling before the shared control/bidi sanitization.
  // eslint-disable-next-line no-control-regex
  const plainTier = row.tier.slice(0, 512).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const tier = sanitizeUntrusted(plainTier, { singleLine: true, maxChars: 80 }).trim();
  if (!tier) return undefined;
  return { providerId: "muse", observedAtMs: row.observedAtMs, tier,
    window: { ...window, windowDurationMins: duration }, weekly };
}
