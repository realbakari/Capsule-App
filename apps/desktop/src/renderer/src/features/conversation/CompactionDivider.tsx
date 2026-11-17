import type { ChatMessage, Run } from "@capsule/shared";

const COMPACT_PROMPT = /^\/(?:compact|context-compact)(?:\s|$)/i;

/** A turn that only asked the agent to compact its context. */
export function isCompactionTurn(prompt: ChatMessage | undefined): boolean {
  return prompt?.role === "user" && COMPACT_PROMPT.test(prompt.content.trim());
}

function label(run: Run | undefined): string {
  if (!run || run.status === "queued" || run.status === "running" || run.status === "waiting" || run.status === "approval_required") return "Compacting context";
  if (run.status === "failed" || run.status === "blocked") return "Context compaction failed";
  if (run.status === "cancelled") return "Context compaction stopped";
  return "Context compacted";
}

/**
 * Compacting is bookkeeping, not a conversation: the agent summarises its own
 * history so the thread can go on. It reads as one divider in the transcript
 * instead of a "/compact" bubble and an answer nobody needs to read.
 */
export function CompactionDivider({ run }: { run?: Run }) {
  const text = label(run);
  const active = text === "Compacting context";
  const failed = run?.status === "failed" || run?.status === "blocked";
  return (
    <div className={`compaction-divider${failed ? " failed" : ""}`} role="status">
      <span className="compaction-divider-rule" aria-hidden />
      <span className={`compaction-divider-label${active ? " shimmer-text" : ""}`}>{text}{run?.error && failed ? `: ${run.error.split("\n")[0]!.slice(0, 120)}` : ""}</span>
      <span className="compaction-divider-rule" aria-hidden />
    </div>
  );
}
