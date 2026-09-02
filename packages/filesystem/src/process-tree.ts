import { spawnSync } from "node:child_process";

/**
 * The agent processes Capsule's work actually costs.
 *
 * Electron's own metrics cover the window and its helpers, which is the
 * cheapest thing on the machine while an agent turn is running. The CLIs doing
 * the work are started by the OpenClaw Gateway, not by Capsule, so they are
 * invisible to `app.getAppMetrics()` and have to be read from the OS.
 */

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** Percent of one core, as ps reports it. */
  cpuPercent: number;
  residentBytes: number;
  /** How long the process has been alive. */
  elapsedSeconds: number;
  /** The executable path ps reports, which may contain spaces. */
  command: string;
  /** The executable's file name. */
  name: string;
}

export interface AgentProcess extends ProcessRow {
  /**
   * When the process started, to the second. A pid on its own is not an
   * identity — the OS reuses them — so anything that follows a process across
   * samples has to compare this too.
   */
  startTimeMs: number;
}

/** `[[dd-]hh:]mm:ss` as ps prints it. */
export function parseElapsedSeconds(value: string): number {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/u.exec(value.trim());
  if (!match) return 0;
  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

/**
 * Rows from `ps -Ao pid=,ppid=,%cpu=,rss=,etime=,comm=`. The command is last
 * because it is the only field that can contain spaces.
 */
export function parsePsTable(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line);
    if (!match) continue;
    const [, pid, ppid, cpu, rss, elapsed, command] = match;
    rows.push({
      pid: Number(pid),
      ppid: Number(ppid),
      cpuPercent: Number(cpu),
      // ps reports resident size in kilobytes.
      residentBytes: Number(rss) * 1024,
      elapsedSeconds: parseElapsedSeconds(elapsed!),
      command: command!,
      name: basename(command!),
    });
  }
  return rows;
}

function basename(command: string): string {
  // Not split on whitespace first: `comm` is the executable path with no
  // arguments, and plenty of macOS executables have a space in the name.
  return command.slice(command.lastIndexOf("/") + 1);
}

/**
 * The processes running an agent: anything whose executable is one of the
 * known CLIs, plus everything descended from it — acpx spawns the harness
 * under the Gateway, so the interesting process is usually a grandchild.
 *
 * The match is on the exact file name, case included. A loose match on
 * "claude" also matches `/Applications/Claude.app/…/Claude`, which is a chat
 * app sitting idle in the Dock, not an agent doing work here.
 */
export function selectAgentPids(rows: readonly ProcessRow[], binaries: ReadonlySet<string>): Set<number> {
  const selected = new Set<number>();
  for (const row of rows) {
    if (binaries.has(row.name)) selected.add(row.pid);
  }
  if (selected.size === 0) return selected;

  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.ppid);
    if (list) list.push(row.pid);
    else children.set(row.ppid, [row.pid]);
  }
  const queue = [...selected];
  while (queue.length > 0) {
    const pid = queue.pop()!;
    for (const child of children.get(pid) ?? []) {
      if (selected.has(child)) continue;
      selected.add(child);
      queue.push(child);
    }
  }
  return selected;
}

/** Reads the process table. Returns nothing rather than throwing when ps is unavailable. */
export function readProcessTable(): ProcessRow[] {
  const result = spawnSync("ps", ["-Ao", "pid=,ppid=,%cpu=,rss=,etime=,comm="], {
    encoding: "utf8",
    timeout: 4_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) return [];
  return parsePsTable(result.stdout);
}

/** The agent processes running right now, newest-costliest first. */
export function readAgentProcesses(
  binaries: ReadonlySet<string>,
  now = Date.now(),
): AgentProcess[] {
  const rows = readProcessTable();
  const pids = selectAgentPids(rows, binaries);
  return rows
    .filter((row) => pids.has(row.pid))
    .map((row) => ({ ...row, startTimeMs: now - row.elapsedSeconds * 1_000 }))
    .sort((a, b) => b.cpuPercent - a.cpuPercent || b.residentBytes - a.residentBytes);
}
