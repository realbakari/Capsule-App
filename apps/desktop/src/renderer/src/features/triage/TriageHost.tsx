import { BackgroundActivity } from "./BackgroundActivity";
import { SnoozeDialog } from "./SnoozeDialog";
import { useTriageShortcuts } from "./useTriageShortcuts";
import { useReopenPanel } from "./useReopenPanel";
import { useAttentionTitle } from "./useAttentionTitle";

/** The app-wide pieces of thread triage: its dialog, its shortcuts, and news from other threads. */
export function TriageHost() {
  useTriageShortcuts();
  useReopenPanel();
  useAttentionTitle();
  return <><SnoozeDialog /><BackgroundActivity /></>;
}
