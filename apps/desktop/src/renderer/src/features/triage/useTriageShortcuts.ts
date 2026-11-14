import { useEffect, useRef } from "react";
import { KEY_COMMAND_EVENT } from "../../lib/keybindings";
import { useThreadTriage } from "../../lib/thread-triage";
import { useWorkspace } from "../../lib/workspace";
import { cycleRegion } from "../../lib/regions";
import { REOPEN_PANEL_EVENT } from "./useReopenPanel";

/**
 * ⌘E settles the open thread and moves to whatever wants you next, so triage
 * is a keyboard loop; ⇧⌘U marks it unread to come back to. Both act on the
 * thread on screen, and only in the conversation view. Their keys come from
 * the keymap, which hands them here by id.
 */
export function useTriageShortcuts() {
  const { sessionId, view } = useWorkspace();
  const triage = useThreadTriage();
  const live = useRef({ triage, sessionId, view });
  live.current = { triage, sessionId, view };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F6" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        cycleRegion(event.shiftKey ? -1 : 1);
      }
    };
    const onCommand = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id === "reopen-panel") { window.dispatchEvent(new CustomEvent(REOPEN_PANEL_EVENT)); return; }
      if (id !== "settle-and-next" && id !== "mark-unread") return;
      const { triage: actions, sessionId: current, view: shown } = live.current;
      if (!current || shown !== "chat" || !actions.writable) return;
      if (id === "settle-and-next") void actions.settle(current, { advance: true });
      else void actions.markUnread(current);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(KEY_COMMAND_EVENT, onCommand);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(KEY_COMMAND_EVENT, onCommand);
    };
  }, []);
}
