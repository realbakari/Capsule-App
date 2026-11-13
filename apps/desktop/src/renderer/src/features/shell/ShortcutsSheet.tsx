import { useEffect, useMemo, useRef, useState } from "react";
import { COMMANDS, FIXED_SHORTCUTS, chordFor, chordSymbols, parseChord, type Keymap } from "../../lib/keybindings";
import { useModalFocus } from "../../lib/modal-focus";
import { SHOW_SHORTCUTS_EVENT } from "../../lib/shortcuts-event";
import { useWorkspace } from "../../lib/workspace";
import { XIcon } from "./icons";

/**
 * Every keyboard shortcut on one sheet (⌘/), including the ones the user has
 * rebound, so the keys can be learned without opening Settings.
 */
export function ShortcutsSheet() {
  const { settings, setView } = useWorkspace();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useModalFocus(card, open, close, "[data-autofocus]");
  useEffect(() => {
    const show = () => setOpen((current) => !current);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show);
  }, []);
  const keymap = useMemo<Keymap>(() => {
    const map: Keymap = {};
    for (const [id, value] of Object.entries(settings?.keybindings ?? {})) {
      const chord = parseChord(value);
      if (chord) map[id] = chord;
    }
    return map;
  }, [settings?.keybindings]);
  if (!open) return null;
  const rows = [
    ...COMMANDS.map((command) => ({ label: command.label, keys: chordSymbols(chordFor(command, keymap)) })),
    ...FIXED_SHORTCUTS,
  ];
  return (
    <div className="palette-backdrop center" onClick={close}>
      <div className="dialog shortcuts-sheet" ref={card} role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={(event) => event.stopPropagation()}>
        <header className="shortcuts-sheet-head">
          <h3 id="shortcuts-title">Keyboard shortcuts</h3>
          <button type="button" className="icon-btn" title="Close (Esc)" aria-label="Close" onClick={close}><XIcon size={14} /></button>
        </header>
        <dl className="shortcuts-list" tabIndex={-1} data-autofocus>
          {rows.map((row) => (
            <div key={row.label} className="shortcuts-row">
              <dt>{row.label}</dt>
              <dd>{row.keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</dd>
            </div>
          ))}
        </dl>
        <footer className="shortcuts-sheet-foot">
          <button type="button" className="chip" onClick={() => { close(); setView("settings"); }}>Change shortcuts in Settings</button>
        </footer>
      </div>
    </div>
  );
}
