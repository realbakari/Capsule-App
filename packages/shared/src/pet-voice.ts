export interface PetVoiceStatus {
  inputAvailable: boolean;
  outputAvailable: boolean;
  detail?: string;
}

/** The macOS settings pane that unblocks a speech failure. */
export type DictationSettingsPane = "microphone" | "speech" | "dictation";
export const DICTATION_SETTINGS_PANES: readonly DictationSettingsPane[] = ["microphone", "speech", "dictation"];

/** How one composer dictation ended. Expected failures resolve; they are not thrown. */
export type DictationOutcome =
  | { kind: "text"; text: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string; settings?: DictationSettingsPane };

/** Streamed to the window that started dictation, and never to a paired device. */
export type DictationEvent =
  | { phase: "listening"; limitMs: number }
  | { phase: "partial"; text: string }
  | { phase: "level"; value: number };
