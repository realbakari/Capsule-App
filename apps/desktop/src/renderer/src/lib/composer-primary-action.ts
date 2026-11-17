/**
 * What the composer's one primary button does right now. While a turn runs,
 * a draft with text is a follow-up (queued, or steered into the turn where
 * the agent takes it), and only an empty draft turns the button into Stop.
 */
export type ComposerPrimaryAction =
  | { kind: "send" }
  | { kind: "run-command" }
  | { kind: "queue" }
  | { kind: "steer" }
  | { kind: "stop"; stopping: boolean };

export function composerPrimaryAction(input: {
  running: boolean;
  stopping: boolean;
  hasContent: boolean;
  /** The draft is a `!command`, which runs here and never reaches the agent. */
  bang: boolean;
  /** A follow-up goes into the running turn rather than the queue. */
  steer: boolean;
}): ComposerPrimaryAction {
  if (input.bang) return { kind: "run-command" };
  if (input.running) {
    if (!input.hasContent) return { kind: "stop", stopping: input.stopping };
    return { kind: input.steer ? "steer" : "queue" };
  }
  return { kind: "send" };
}

export const PRIMARY_ACTION_LABELS: Record<ComposerPrimaryAction["kind"], string> = {
  send: "Send message",
  "run-command": "Run command",
  queue: "Queue follow-up",
  steer: "Steer this turn",
  stop: "Stop",
};
