import { useEffect, useMemo, useRef } from "react";
import { commandForEvent, keymapFrom, type Keymap } from "../../lib/keybindings";
import { useThreadTriage } from "../../lib/thread-triage";
import { useWorkspace } from "../../lib/workspace";
import { cycleRegion } from "../../lib/regions";

/**
 * ⌘E settles the open thread and moves to whatever wants you next, so triage
 * is a keyboard loop; ⇧⌘U marks it unread to come back to. Both act on the
 * thread on screen, and only in the conversation view.
 */
export function useTriageShortcuts() {
  const { settings, sessionId, view } = useWorkspace();
  const triage = useThreadTriage();
  const keymap = useMemo<Keymap>(() => keymapFrom(settings?.keybindings), [settings?.keybindings]);
  const live = useRef({ triage, sessionId, view });
  live.current = { triage, sessionId, view };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "F6" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        cycleRegion(event.shiftKey ? -1 : 1);
        return;
      }
      const command = commandForEvent(event, keymap);
      if (command?.id !== "settle-and-next" && command?.id !== "mark-unread") return;
      const { triage: actions, sessionId: id, view: current } = live.current;
      if (!id || current !== "chat" || !actions.writable) return;
      event.preventDefault();
      if (command.id === "settle-and-next") void actions.settle(id, { advance: true });
      else void actions.markUnread(id);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [keymap]);
}
