import { useEffect, useState } from "react";
import { isMac } from "../../lib/keybindings";

/** Long enough that a quick ⌘C never flashes the numbers. */
export const JUMP_HINT_DELAY_MS = 200;

/**
 * Whether ⌘ (Control on Windows and Linux) has been held on its own for a
 * moment, so the sidebar can number the rows ⌘1–⌘9 open. Releasing it,
 * pressing any key but a digit, or leaving the window hides the numbers.
 */
export function useJumpHintsHeld(enabled: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const mac = isMac();
    const modifierKey = mac ? "Meta" : "Control";
    const primary = (event: KeyboardEvent) => (mac ? event.metaKey : event.ctrlKey);
    let timer: number | undefined;
    const hide = () => {
      window.clearTimeout(timer);
      timer = undefined;
      setHeld(false);
    };
    const onDown = (event: KeyboardEvent) => {
      if (event.key === modifierKey && !event.shiftKey && !event.altKey && !(mac ? event.ctrlKey : event.metaKey)) {
        timer ??= window.setTimeout(() => setHeld(true), JUMP_HINT_DELAY_MS);
        return;
      }
      // A digit is the jump itself; the numbers stay up for the next one.
      if (primary(event) && /^[1-9]$/.test(event.key)) return;
      hide();
    };
    const onUp = (event: KeyboardEvent) => {
      if (event.key === modifierKey || !primary(event)) hide();
    };
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      window.removeEventListener("blur", hide);
      hide();
    };
  }, [enabled]);
  return enabled && held;
}
