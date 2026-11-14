/** What a tool call did, as ACP names it. Anything else is "other". */
export type ToolKind = "read" | "edit" | "delete" | "move" | "switch_mode" | "search" | "execute" | "think" | "fetch" | "todo" | "other";

/** The part of a tool call a run summary needs. A transcript's own observations fit this shape. */
export interface ToolRunStep {
  kind: ToolKind;
  status: string;
  details?: { locations?: readonly string[] };
}

/*
 * One phrase per kind. File kinds count distinct paths when the agent reported
 * them, and fall back to one per call when it did not, so a read of the same
 * file twice is one file read and an unlabelled read still counts.
 */
const PHRASES: Record<ToolKind, { counts: "files" | "calls"; say: (count: number) => string }> = {
  read: { counts: "files", say: (n) => `read ${n} file${n === 1 ? "" : "s"}` },
  edit: { counts: "files", say: (n) => `edited ${n} file${n === 1 ? "" : "s"}` },
  delete: { counts: "files", say: (n) => `deleted ${n} file${n === 1 ? "" : "s"}` },
  move: { counts: "files", say: (n) => `moved ${n} file${n === 1 ? "" : "s"}` },
  search: { counts: "calls", say: (n) => n === 1 ? "searched once" : `searched ${n} times` },
  execute: { counts: "calls", say: (n) => `ran ${n} command${n === 1 ? "" : "s"}` },
  fetch: { counts: "calls", say: (n) => `fetched ${n} page${n === 1 ? "" : "s"}` },
  think: { counts: "calls", say: (n) => n === 1 ? "thought it through" : `thought ${n} times` },
  todo: { counts: "calls", say: (n) => n === 1 ? "updated the plan" : `updated the plan ${n} times` },
  switch_mode: { counts: "calls", say: (n) => n === 1 ? "switched mode" : `switched mode ${n} times` },
  other: { counts: "calls", say: (n) => `used ${n} tool${n === 1 ? "" : "s"}` },
};

/**
 * "Read 6 files, ran 2 commands (1 failed), edited 3 files": a run of tool
 * calls said the way a person would, in the order the work happened. A
 * failure is named beside the kind of work that failed, never dropped.
 */
export function summarizeToolRun(steps: readonly ToolRunStep[]): string {
  const groups = new Map<ToolKind, { calls: number; failed: number; paths: Set<string>; unlabelled: number }>();
  for (const step of steps) {
    const group = groups.get(step.kind) ?? { calls: 0, failed: 0, paths: new Set<string>(), unlabelled: 0 };
    groups.set(step.kind, group);
    group.calls += 1;
    if (step.status === "failed") group.failed += 1;
    const paths = step.details?.locations ?? [];
    if (paths.length) for (const path of paths) group.paths.add(path);
    else group.unlabelled += 1;
  }
  const text = [...groups].map(([kind, group]) => {
    const phrase = PHRASES[kind];
    const count = phrase.counts === "files" ? group.paths.size + group.unlabelled : group.calls;
    return `${phrase.say(count)}${group.failed ? ` (${group.failed} failed)` : ""}`;
  }).join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
