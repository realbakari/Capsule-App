import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { HARNESS_IDS, type Run, type Session } from "@capsule/shared";
import { ANALYTICS_CONFIG } from "./analytics-config";

type Event = {
  event: "app_started" | "installation_active" | "run_started" | "run_finished" | "performance_sample";
  properties: Record<string, string | number | boolean>;
  timestamp: string;
};

/** Main-process only. No generic renderer capture, autocapture, replay or raw errors. */
export class ProductAnalytics {
  private identity: string | undefined;
  private enabled = false;
  private queue: Event[] = [];
  private sending: AbortController | undefined;
  private seen = new Map<string, string>();
  private activeDay = "";
  private lastPerformanceAt = 0;
  private error: string | undefined;
  private lastSentAt: string | undefined;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly options: {
    identityPath: string;
    version: string;
    platform: string;
    fetch?: typeof fetch;
    disabled?: boolean;
  }) {
    this.timer = setInterval(() => { void this.flush(); }, 30_000);
    this.timer.unref();
  }

  status() {
    return { enabled: this.enabled, configured: true, host: ANALYTICS_CONFIG.host,
      pending: this.queue.length, lastSentAt: this.lastSentAt, error: this.error };
  }

  setConsent(consent: boolean): void {
    const enabled = consent && !this.options.disabled;
    if (!enabled) {
      this.enabled = false;
      this.sending?.abort();
      this.queue = [];
      this.seen.clear();
      this.identity = undefined;
      this.activeDay = "";
      this.error = undefined;
      try { if (existsSync(this.options.identityPath)) unlinkSync(this.options.identityPath); }
      catch { this.error = "Collection is off, but the local analytics identifier could not be removed."; }
      return;
    }
    if (this.enabled) return;
    try {
      const stored = existsSync(this.options.identityPath) ? readFileSync(this.options.identityPath, "utf8").trim() : "";
      this.identity = /^[0-9a-f]{8}-[0-9a-f-]{27}$/u.test(stored) ? stored : randomUUID();
      writeFileSync(this.options.identityPath, this.identity, { mode: 0o600 });
      this.enabled = true;
      this.error = undefined;
      this.record("app_started", {});
      this.active();
    } catch {
      this.error = "Analytics could not start. No events are being collected.";
    }
  }

  private record(event: Event["event"], properties: Event["properties"]): void {
    if (!this.enabled) return;
    this.queue.push({ event, properties, timestamp: new Date().toISOString() });
    if (this.queue.length > 100) this.queue.shift();
  }

  private active(): void {
    const day = new Date().toISOString().slice(0, 10);
    if (day === this.activeDay) return;
    this.activeDay = day;
    this.record("installation_active", {});
  }

  performance(cpuPercent: number, memoryBytes: number): void {
    if (!this.enabled || Date.now() - this.lastPerformanceAt < 600_000) return;
    if (!Number.isFinite(cpuPercent) || !Number.isFinite(memoryBytes) || cpuPercent < 0 || memoryBytes < 0) return;
    this.lastPerformanceAt = Date.now();
    this.record("performance_sample", { app_cpu_percent: Math.round(cpuPercent), app_memory_mb: Math.round(memoryBytes / 1_048_576) });
  }

  observeRun(run: Run, getSession: () => Session | undefined): void {
    if (!this.enabled) return;
    const terminal = ["completed", "failed", "cancelled", "blocked"].includes(run.status);
    const previous = this.seen.get(run.id);
    if (previous === "finished" || previous === "started" && !terminal) return;
    const session = getSession();
    const key = session?.openclawSessionKey;
    const route = key?.startsWith("direct:") ? "direct" : key ? "gateway" : "unknown";
    const harness = HARNESS_IDS.find((id) => id === session?.harnessId) ?? "other";
    this.active();
    if (!previous) this.record("run_started", { harness, route });
    this.seen.set(run.id, terminal ? "finished" : "started");
    if (this.seen.size > 2000) this.seen.delete(this.seen.keys().next().value!);
    if (terminal) {
      const elapsed = Date.parse(run.completedAt ?? run.updatedAt) - Date.parse(run.createdAt);
      this.record("run_finished", { harness, route, outcome: run.status,
        ...(Number.isFinite(elapsed) && elapsed >= 0 ? { duration_ms: Math.min(elapsed, 7 * 86_400_000) } : {}),
      });
    }
  }

  async flush(): Promise<void> {
    if (!this.enabled || !this.identity || this.sending || !this.queue.length) return;
    const identity = this.identity;
    const batch = this.queue.splice(0, 20);
    const controller = new AbortController();
    this.sending = controller;
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref();
    try {
      const response = await (this.options.fetch ?? fetch)(`${ANALYTICS_CONFIG.host}/batch/`, {
        method: "POST", headers: { "content-type": "application/json" }, redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({ api_key: ANALYTICS_CONFIG.key, batch: batch.map((item) => ({
          event: item.event, timestamp: item.timestamp,
          properties: { ...item.properties, distinct_id: identity, $process_person_profile: false,
            $geoip_disable: true, app_version: this.options.version,
            platform: ["darwin", "win32", "linux"].includes(this.options.platform) ? this.options.platform : "other",
          },
        })) }),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error("rejected");
      if (this.enabled && this.identity === identity) {
        this.lastSentAt = new Date().toISOString();
        this.error = undefined;
      }
    } catch {
      if (this.enabled && this.identity === identity) this.error = "Analytics delivery failed. This batch was dropped; your work is unaffected.";
    } finally {
      clearTimeout(timeout);
      this.sending = undefined;
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.enabled = false;
    this.queue = [];
    this.sending?.abort();
  }
}
