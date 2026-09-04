import { parseUnifiedDiff, type Run, type RunEvent, type TurnDiffResult } from "@capsule/shared";
import { extractTouchedFiles, type TouchedFile } from "./activity";
import type { Turn } from "./turns";

const IN_FLIGHT = new Set(["queued", "running", "waiting", "approval_required"]);

/** One owner per run; never assign a checkpoint just because it is newest. */
export function outcomesByTurn(turns: readonly Turn[], runs: readonly Run[], sessionId?: string, projectId?: string): Map<string, Run[]> {
  const result = new Map<string, Run[]>();
  if (!sessionId || !projectId) return result;
  const prompts = new Map<string, Turn>();
  const replies = new Map<string, Turn>();
  const legacy = new Map<string, Array<{ turn: Turn; start: number; end: number }>>();
  let nextPromptTime = Infinity;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const prompt = turn.prompt;
    if (prompt?.sessionId === sessionId) {
      if (prompt.runId) prompts.set(prompt.runId, turn);
      else if (!prompt.id.startsWith("local-")) {
        const text = prompt.content.trim();
        const candidates = legacy.get(text) ?? [];
        candidates.push({ turn, start: Date.parse(prompt.createdAt), end: nextPromptTime });
        legacy.set(text, candidates);
      }
      nextPromptTime = Date.parse(prompt.createdAt);
    }
    if (!prompt?.runId) {
      for (const message of turn.messages) {
        if (message.sessionId === sessionId && message.runId) replies.set(message.runId, turn);
      }
    }
  }
  for (const run of runs) {
    if (run.sessionId !== sessionId || run.projectId !== projectId || IN_FLIGHT.has(run.status)) continue;
    let owner = prompts.get(run.id);
    // Older prompts did not carry runId. Use their time window and content,
    // not the position of a run in a newest-first array or a repeated prompt.
    if (!owner) {
      const time = Date.parse(run.createdAt);
      const candidates = (legacy.get(run.prompt.trim()) ?? []).filter((candidate) => time >= candidate.start && time < candidate.end);
      if (candidates.length === 1) owner = candidates[0]?.turn;
    }
    if (!owner) {
      owner = replies.get(run.id);
    }
    if (!owner) continue;
    const owned = result.get(owner.id) ?? [];
    owned.push(run);
    result.set(owner.id, owned);
  }
  for (const owned of result.values()) owned.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return result;
}

/** A successful empty snapshot is authoritative. Do not resurrect older files. */
export function outcomeFiles(diff: TurnDiffResult | undefined, events: readonly RunEvent[], runId: string, cwd?: string): TouchedFile[] {
  if (diff && diff.available !== false) {
    const statuses = new Map(parseUnifiedDiff(diff.patch).map((file) => [file.path, file.status]));
    return diff.files.map((file) => ({
      ...file,
      // Removing lines does not mean the file was deleted.
      action: statuses.get(file.path) === "deleted" ? "deleted" : statuses.get(file.path) === "added" ? "created" : "modified",
    }));
  }
  // Repository status is deliberately not an input: even a read of a dirty
  // file must not attribute someone else's edits to this turn.
  return extractTouchedFiles(events.filter((event) => event.runId === runId), undefined, cwd)
    .filter((file) => file.action !== "read");
}

export async function loadTurnOutcome(run: Run, cwd: string | undefined, reader: {
  turnDiff: (runId: string) => Promise<TurnDiffResult>;
  listRunEvents: (runId: string) => Promise<RunEvent[]>;
}): Promise<{ files: TouchedFile[]; patch?: string }> {
  const diff = run.checkpointRef ? await reader.turnDiff(run.id) : undefined;
  const events = !diff || diff.available === false ? await reader.listRunEvents(run.id) : [];
  return { files: outcomeFiles(diff, events, run.id, cwd), patch: diff?.available !== false ? diff?.patch : undefined };
}
