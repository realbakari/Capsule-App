import { ansiToSegments, createId, type AnsiLine, type CustomizationRunRecord, type StatusLineRender } from "@capsule/shared";
import { runWithInput } from "@capsule/terminal";

export const STATUS_LINE_TIMEOUT_MS = 5_000;
/** A thread's command starts at most this often, however many events arrive. */
export const STATUS_LINE_MIN_GAP_MS = 1_000;
const OUTPUT_BYTES = 16 * 1024;
const STDERR_KEPT = 2048;

export interface StatusLineJob {
  key: string;
  cwd: string;
  projectDir?: string;
  input: Record<string, unknown>;
}

export type StatusLineResult =
  | { ok: true; lines: AnsiLine[]; durationMs: number }
  | { ok: false; failed: string; exitCode: number | null; stderr?: string; durationMs: number };

/** Run the person's status line command once: JSON on stdin, at most two styled lines back. */
export async function runStatusLineCommand(
  command: string,
  job: Pick<StatusLineJob, "cwd" | "projectDir" | "input">,
  options: { timeoutMs?: number; run?: typeof runWithInput } = {},
): Promise<StatusLineResult> {
  const timeoutMs = options.timeoutMs ?? STATUS_LINE_TIMEOUT_MS;
  const started = Date.now();
  try {
    const result = await (options.run ?? runWithInput)(job.cwd, command, {
      input: JSON.stringify(job.input),
      env: { CAPSULE_PROJECT_DIR: job.projectDir ?? job.cwd },
      timeoutMs,
      maxBytes: OUTPUT_BYTES,
    });
    const stderr = result.stderr ? result.stderr.slice(-STDERR_KEPT) : undefined;
    if (result.timedOut) return { ok: false, failed: `timed out after ${timeoutMs / 1000}s`, exitCode: null, ...(stderr ? { stderr } : {}), durationMs: result.durationMs };
    if (result.code !== 0) return { ok: false, failed: `exit ${result.code}`, exitCode: result.code, ...(stderr ? { stderr } : {}), durationMs: result.durationMs };
    const text = result.stdout.replace(/\r?\n+$/, "");
    return { ok: true, lines: text ? ansiToSegments(text, 2) : [], durationMs: result.durationMs };
  } catch (error) {
    return { ok: false, failed: `did not start: ${error instanceof Error ? error.message : String(error)}`, exitCode: null, durationMs: Date.now() - started };
  }
}

export interface StatusLineHost {
  /** The person's own command; a project file never supplies one. */
  command(): { command: string; source: string } | undefined;
  emit(render: StatusLineRender): void;
  record(run: CustomizationRunRecord): void;
}

interface Lane {
  running: boolean;
  lastStart: number;
  pending?: StatusLineJob;
  timer?: NodeJS.Timeout;
}

/**
 * One lane per thread: requests that arrive while a run is going, or within
 * a second of the last start, collapse into one trailing run with the
 * newest facts, so a burst of events costs one process.
 */
export class StatusLineRunner {
  private readonly lanes = new Map<string, Lane>();
  private readonly renders = new Map<string, StatusLineRender>();
  private stopped = false;

  constructor(
    private readonly host: StatusLineHost,
    private readonly options: { gapMs?: number; timeoutMs?: number; now?: () => number; run?: typeof runWithInput } = {},
  ) {}

  private get now(): number { return this.options.now?.() ?? Date.now(); }

  request(job: StatusLineJob): void {
    if (this.stopped) return;
    const lane = this.lanes.get(job.key) ?? { running: false, lastStart: Number.NEGATIVE_INFINITY };
    this.lanes.set(job.key, lane);
    lane.pending = job;
    this.pump(job.key);
  }

  latest(key: string): StatusLineRender | undefined {
    return this.renders.get(key);
  }

  stop(): void {
    this.stopped = true;
    for (const lane of this.lanes.values()) if (lane.timer) clearTimeout(lane.timer);
    this.lanes.clear();
  }

  private pump(key: string): void {
    const lane = this.lanes.get(key);
    if (!lane || lane.running || lane.timer || !lane.pending || this.stopped) return;
    const wait = lane.lastStart + (this.options.gapMs ?? STATUS_LINE_MIN_GAP_MS) - this.now;
    if (wait > 0) {
      lane.timer = setTimeout(() => {
        lane.timer = undefined;
        this.pump(key);
      }, wait);
      lane.timer.unref?.();
      return;
    }
    const job = lane.pending;
    lane.pending = undefined;
    lane.running = true;
    lane.lastStart = this.now;
    void this.execute(job).finally(() => {
      lane.running = false;
      this.pump(key);
    });
  }

  private async execute(job: StatusLineJob): Promise<void> {
    const command = this.host.command();
    if (!command) return;
    const startedAt = new Date(this.now).toISOString();
    const result = await runStatusLineCommand(command.command, job, { timeoutMs: this.options.timeoutMs, run: this.options.run });
    if (this.stopped) return;
    const previous = this.renders.get(job.key);
    const render: StatusLineRender = result.ok
      ? { key: job.key, lines: result.lines, at: new Date(this.now).toISOString() }
      // The last good line stays visible, dimmed, with the reason beside it.
      : { key: job.key, lines: previous?.lines ?? [], failed: result.failed, at: new Date(this.now).toISOString() };
    this.renders.set(job.key, render);
    this.host.emit(render);
    // A failing command would fill the doctor's log once a second; it records when the reason changes.
    if (!result.ok && previous?.failed !== result.failed) {
      this.host.record({
        id: createId("status-line"),
        kind: "status-line",
        label: "Status line",
        command: command.command,
        source: command.source,
        startedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        ...(result.stderr ? { stderr: result.stderr } : {}),
        outcome: result.failed,
      });
    }
  }
}
