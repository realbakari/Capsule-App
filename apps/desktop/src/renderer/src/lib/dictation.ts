import type { DictationSettingsPane } from "@capsule/shared";

/** Fired by the dictation chord; the mounted composer starts or finishes. */
export const TOGGLE_DICTATION_EVENT = "capsule:toggle-dictation";

/** The draft around the caret when dictation began. Spoken text goes between. */
export interface DictationAnchor {
  original: string;
  before: string;
  after: string;
}

export type DictationState =
  | { phase: "idle" }
  | { phase: "starting"; anchor: DictationAnchor }
  | { phase: "listening"; anchor: DictationAnchor; text: string; level: number; startedAt: number; limitMs: number }
  | { phase: "finishing"; anchor: DictationAnchor; text: string }
  | { phase: "error"; message: string; settings?: DictationSettingsPane };

export function isDictating(state: DictationState): state is Extract<DictationState, { anchor: DictationAnchor }> {
  return "anchor" in state;
}

/** A selection is replaced by what is said, the way system dictation does. */
export function anchorAt(draft: string, start: number, end: number): DictationAnchor {
  const from = Math.max(0, Math.min(start, end, draft.length));
  const to = Math.min(draft.length, Math.max(start, end, from));
  return { original: draft, before: draft.slice(0, from), after: draft.slice(to) };
}

/** The draft with spoken text at the anchor, spaced from its neighbours, and the caret after it. */
export function spliceDictation(anchor: DictationAnchor, text: string): { draft: string; caret: number } {
  const spoken = text.trim();
  if (!spoken) return { draft: anchor.before + anchor.after, caret: anchor.before.length };
  const lead = anchor.before && !/\s$/.test(anchor.before) ? " " : "";
  const trail = anchor.after && !/^[\s.,;:!?)\]}]/.test(anchor.after) ? " " : "";
  const draft = anchor.before + lead + spoken + trail + anchor.after;
  return { draft, caret: anchor.before.length + lead.length + spoken.length };
}

/** Why this device cannot dictate, or undefined when it can try. */
export function dictationUnavailableReason(api: { isDesktop?: boolean; platform?: string }): string | undefined {
  if (api.isDesktop === false) return "Dictation runs on the Mac. Dictate from Capsule on that Mac, then the text appears here.";
  if (api.platform && api.platform !== "darwin") return "Dictation is unavailable here. It uses on-device speech recognition on macOS.";
  return undefined;
}

export const COUNTDOWN_MS = 15_000;

function formatClock(seconds: number): string {
  const whole = Math.max(0, seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** Elapsed time while there is room, then a countdown near the cap. */
export function recordingClock(elapsedMs: number, limitMs: number): { label: string; ending: boolean } {
  const remaining = limitMs - elapsedMs;
  if (remaining <= COUNTDOWN_MS) return { label: `Stops in ${formatClock(Math.ceil(remaining / 1000))}`, ending: true };
  return { label: formatClock(Math.floor(elapsedMs / 1000)), ending: false };
}
