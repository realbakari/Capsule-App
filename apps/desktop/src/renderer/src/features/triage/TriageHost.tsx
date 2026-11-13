import { BackgroundActivity } from "./BackgroundActivity";
import { SnoozeDialog } from "./SnoozeDialog";
import { useTriageShortcuts } from "./useTriageShortcuts";

/** The app-wide pieces of thread triage: its dialog, its shortcuts, and news from other threads. */
export function TriageHost() {
  useTriageShortcuts();
  return <><SnoozeDialog /><BackgroundActivity /></>;
}
