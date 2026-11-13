import { SnoozeDialog } from "./SnoozeDialog";
import { useTriageShortcuts } from "./useTriageShortcuts";

/** The app-wide pieces of thread triage: its dialog and its shortcuts. */
export function TriageHost() {
  useTriageShortcuts();
  return <SnoozeDialog />;
}
