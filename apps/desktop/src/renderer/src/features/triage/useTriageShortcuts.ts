import { useEffect, useMemo, useRef } from "react";
import { commandForEvent, parseChord, type Keymap } from "../../lib/keybindings";
import { useThreadTriage } from "../../lib/thread-triage";
import { useWorkspace } from "../../lib/workspace";

/**
 * ⌘E settles the open thread and moves to whatever wants you next, so triage
 * is a keyboard loop; ⇧⌘U marks it unread to come back to. Both act on the
 * thread on screen, and only in the conversation view.
 */
export function useTriageShortcuts() {
  const { settings, sessionId, view } = useWorkspace();
  const triage = useThreadTriage();
  const keymap = useMemo<Keymap>(() => {
    const map: Keymap = {};
    for (const [id, value] of Object.entries(settings?.keybindings ?? {})) {
      const chord = parseChord(value);
      if (chord) map[id] = chord;
    }
    return map;
  }, [settings?.keybindings]);
  const live = useRef({ triage, sessionId, view });
  live.current = { triage, sessionId, view };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
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
