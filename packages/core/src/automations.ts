import {
  automationMessage,
  createId,
  describeRRule,
  nextOccurrence,
  occurrencesBetween,
  readAutomation,
  type AutomationConfig,
  type AutomationLastRun,
  type AutomationMissed,
  type AutomationView,
  type CustomizationRunRecord,
  type Provenance,
  type RunStatus,
} from "@capsule/shared";

/*
 * Runs automations on their schedules while Capsule is open. An occurrence
 * that passed while Capsule was closed or the computer slept is counted as
 * missed and waits for the person; it is never replayed on its own.
 */

export interface AutomationEntry {
  key: string;
  /** The project its threads go to. Absent for the person's own, which go to the Inbox. */
  projectId?: string;
  automation: AutomationConfig;
  source: Provenance;
}

export interface AutomationHost {
  entries(): AutomationEntry[];
  read(key: string): string | undefined;
  write(key: string, value: string): void;
  keys(prefix: string): string[];
  /** Start a thread and send its first message. `created` is called as soon as the thread exists. */
  start(entry: AutomationEntry, at: Date, created: (sessionId: string) => void): Promise<{ sessionId: string; runId: string }>;
  runStatus(runId: string): RunStatus | undefined;
  emit(): void;
  record(run: CustomizationRunRecord): void;
}

interface StoredState {
  /** The rule's anchor: INTERVAL counts from here and nothing occurs before it. */
  firstSeenAt: string;
  /** Every occurrence up to here is accounted for: run, skipped or missed. */
  checkedAt: string;
  lastRun?: AutomationLastRun;
  skippedAt?: string;
  missed?: AutomationMissed;
}

const PREFIX = "automation:";
export const AUTOMATION_TICK_MS = 30_000;
/** An occurrence later than this was missed, not due: Capsule was closed, or the computer slept through it. */
export const AUTOMATION_GRACE_MS = 2 * 60_000;
const ENDED = new Set<RunStatus>(["completed", "failed", "cancelled", "blocked"]);

export class AutomationScheduler {
  private ticker?: NodeJS.Timeout;
  private stopped = true;
  private readonly starting = new Set<string>();
  /** Runs started by an automation and not yet ended, by run id. */
  private readonly active = new Map<string, string>();

  constructor(
    private readonly host: AutomationHost,
    private readonly options: { tickMs?: number; graceMs?: number; now?: () => number } = {},
  ) {}

  private get now(): number { return this.options.now?.() ?? Date.now(); }

  start(): void {
    this.stopped = false;
    this.reconcile();
    this.tick();
    this.ticker = setInterval(() => this.tick(), this.options.tickMs ?? AUTOMATION_TICK_MS);
    this.ticker.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
  }

  /** Account for every occurrence up to now: run the one due, count the late ones as missed. */
  tick(): void {
    if (this.stopped) return;
    const now = new Date(this.now);
    const grace = this.options.graceMs ?? AUTOMATION_GRACE_MS;
    const entries = this.host.entries();
    const seen = new Set(entries.map((entry) => entry.key));
    let changed = false;
    for (const entry of entries) {
      const state = this.state(entry.key, now);
      const read = readAutomation(entry.automation);
      const from = new Date(state.checkedAt);
      state.checkedAt = now.toISOString();
      if (!read.ok || entry.automation.enabled === false) {
        this.save(entry.key, state);
        continue;
      }
      const due = occurrencesBetween(read.rule, from, now, 1000, new Date(state.firstSeenAt));
      const late = due.filter((time) => now.getTime() - time.getTime() > grace);
      const onTime = due.filter((time) => now.getTime() - time.getTime() <= grace);
      if (late.length > 0) {
        state.missed = {
          count: (state.missed?.count ?? 0) + late.length,
          first: state.missed?.first ?? late[0]!.toISOString(),
          last: late[late.length - 1]!.toISOString(),
        };
        changed = true;
      }
      const occurrence = onTime[onTime.length - 1];
      if (occurrence && this.isRunning(entry.key, state)) {
        state.skippedAt = occurrence.toISOString();
        this.recordOutcome(entry, now, "skipped: the previous run was still going");
        changed = true;
      }
      this.save(entry.key, state);
      if (occurrence && !this.isRunning(entry.key, state)) {
        void this.fire(entry, "schedule");
        changed = true;
      }
    }
    // An entry gone from the files is treated like a paused one, so adding it back later does not count the gap as missed.
    for (const key of this.host.keys(PREFIX)) {
      const id = key.slice(PREFIX.length);
      if (seen.has(id)) continue;
      const state = this.load(id);
      if (state) this.save(id, { ...state, checkedAt: now.toISOString() });
    }
    if (changed) this.host.emit();
  }

  /** A run ended. If an automation started it, its last run says how it went. */
  runEnded(runId: string, status: RunStatus, error?: string): void {
    const key = this.active.get(runId);
    if (!key || !ENDED.has(status)) return;
    this.active.delete(runId);
    const state = this.load(key);
    if (!state?.lastRun || state.lastRun.runId !== runId) return;
    state.lastRun = finished(state.lastRun, status, new Date(this.now), error);
    this.save(key, state);
    const entry = this.host.entries().find((item) => item.key === key);
    if (entry) this.recordOutcome(entry, new Date(state.lastRun.at), state.lastRun.status === "completed" ? "completed" : `failed: ${state.lastRun.detail ?? status}`, state.lastRun);
    this.host.emit();
  }

  /** Start one now. This is also how missed occurrences are answered. `created` hears the thread as soon as it exists. */
  async runNow(key: string, created?: (sessionId: string) => void): Promise<AutomationLastRun> {
    const entry = this.require(key);
    const read = readAutomation(entry.automation);
    if (!read.ok) throw new Error(`${entry.automation.name} cannot run: ${read.message}`);
    const now = new Date(this.now);
    const state = this.state(key, now);
    if (this.isRunning(key, state)) throw new Error(`${entry.automation.name} is still running. Wait for that run to finish.`);
    this.save(key, { ...state, missed: undefined });
    return this.fire(entry, "manual", created);
  }

  dismissMissed(key: string): void {
    this.require(key);
    const state = this.load(key);
    if (!state?.missed) return;
    this.save(key, { ...state, missed: undefined });
    this.host.emit();
  }

  views(include: (entry: AutomationEntry) => boolean = () => true): AutomationView[] {
    const now = new Date(this.now);
    return this.host.entries().filter(include).map((entry) => {
      const { automation } = entry;
      const state = this.load(entry.key);
      const anchor = new Date(state?.firstSeenAt ?? now.toISOString());
      const read = readAutomation(automation);
      const enabled = automation.enabled !== false;
      const next = read.ok && enabled && !this.stopped ? nextOccurrence(read.rule, now, anchor) : undefined;
      return {
        key: entry.key,
        id: automation.id,
        name: automation.name,
        schedule: automation.schedule,
        ...(read.ok ? { scheduleText: describeRRule(read.rule, anchor) } : { problem: read.message }),
        ...(automation.prompt ? { prompt: automation.prompt } : {}),
        ...(automation.command ? { command: automation.command } : {}),
        ...(automation.profile ? { profile: automation.profile } : {}),
        ...(automation.workspace ? { workspace: automation.workspace } : {}),
        enabled,
        source: entry.source,
        ...(entry.projectId ? { projectId: entry.projectId } : {}),
        ...(next ? { nextRunAt: next.toISOString() } : {}),
        ...(state?.lastRun ? { lastRun: state.lastRun } : {}),
        ...(state?.skippedAt ? { skippedAt: state.skippedAt } : {}),
        ...(state?.missed ? { missed: state.missed } : {}),
        running: this.isRunning(entry.key, state),
      };
    });
  }

  private async fire(entry: AutomationEntry, trigger: AutomationLastRun["trigger"], created?: (sessionId: string) => void): Promise<AutomationLastRun> {
    this.starting.add(entry.key);
    const startedAt = new Date(this.now);
    let last: AutomationLastRun = { at: startedAt.toISOString(), trigger, status: "running" };
    this.patch(entry.key, { lastRun: last });
    this.host.emit();
    try {
      const { sessionId, runId } = await this.host.start(entry, startedAt, (sessionId) => {
        last = { ...last, sessionId };
        created?.(sessionId);
      });
      last = { ...last, sessionId, runId };
      const status = this.host.runStatus(runId);
      if (status && ENDED.has(status)) last = finished(last, status, new Date(this.now));
      else this.active.set(runId, entry.key);
    } catch (error) {
      last = { ...last, status: "failed", finishedAt: new Date(this.now).toISOString(), detail: error instanceof Error ? error.message : String(error) };
    } finally {
      this.starting.delete(entry.key);
    }
    this.patch(entry.key, { lastRun: last });
    if (last.status !== "running") this.recordOutcome(entry, startedAt, last.status === "completed" ? "completed" : `failed: ${last.detail ?? "did not start"}`, last);
    this.host.emit();
    return last;
  }

  /** After a restart: a run left "running" either ended while Capsule was away or never started. */
  private reconcile(): void {
    const now = new Date(this.now);
    for (const key of this.host.keys(PREFIX)) {
      const id = key.slice(PREFIX.length);
      const state = this.load(id);
      if (state?.lastRun?.status !== "running") continue;
      const status = state.lastRun.runId ? this.host.runStatus(state.lastRun.runId) : undefined;
      if (status && !ENDED.has(status)) { this.active.set(state.lastRun.runId!, id); continue; }
      state.lastRun = status ? finished(state.lastRun, status, now) : { ...state.lastRun, status: "failed", finishedAt: now.toISOString(), detail: "Capsule closed before the run started." };
      this.save(id, state);
    }
  }

  private isRunning(key: string, state: StoredState | undefined): boolean {
    return this.starting.has(key) || (state?.lastRun?.status === "running" && (!state.lastRun.runId || this.active.has(state.lastRun.runId)));
  }

  private require(key: string): AutomationEntry {
    const entry = this.host.entries().find((item) => item.key === key);
    if (!entry) throw new Error("That automation is no longer in your settings files.");
    return entry;
  }

  private recordOutcome(entry: AutomationEntry, at: Date, outcome: string, last?: AutomationLastRun): void {
    this.host.record({
      id: createId("automation"),
      kind: "automation",
      label: entry.automation.name,
      command: automationMessage(entry.automation),
      source: entry.source.path ?? entry.source.scope,
      startedAt: at.toISOString(),
      durationMs: last?.finishedAt ? Math.max(0, Date.parse(last.finishedAt) - at.getTime()) : 0,
      exitCode: null,
      outcome,
    });
  }

  private state(key: string, now: Date): StoredState {
    return this.load(key) ?? { firstSeenAt: now.toISOString(), checkedAt: now.toISOString() };
  }

  private load(key: string): StoredState | undefined {
    const raw = this.host.read(PREFIX + key);
    if (!raw) return undefined;
    try {
      const value = JSON.parse(raw) as StoredState;
      return typeof value.firstSeenAt === "string" && typeof value.checkedAt === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private save(key: string, state: StoredState): void {
    this.host.write(PREFIX + key, JSON.stringify(state));
  }

  private patch(key: string, change: Partial<StoredState>): void {
    this.save(key, { ...this.state(key, new Date(this.now)), ...change });
  }
}

function finished(last: AutomationLastRun, status: RunStatus, at: Date, error?: string): AutomationLastRun {
  const ok = status === "completed";
  return {
    ...last,
    status: ok ? "completed" : "failed",
    finishedAt: at.toISOString(),
    ...(ok ? {} : { detail: error?.trim() || (status === "cancelled" ? "The run was stopped." : status === "blocked" ? "The run was blocked." : "The run failed.") }),
  };
}
