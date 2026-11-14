import { useEffect, useRef, useState } from "react";
import { parseChordSequence, takenByMenu } from "@capsule/shared";
import { CONTEXT_LABELS, FIXED_SHORTCUTS, actionLabel, registryRows, sequenceSymbols } from "../../lib/keybindings";
import { useModalFocus } from "../../lib/modal-focus";
import { SHOW_SHORTCUTS_EVENT } from "../../lib/shortcuts-event";
import { useWorkspace } from "../../lib/workspace";
import { XIcon } from "./icons";

/**
 * Every keyboard shortcut on one sheet (⌘/), including the ones the user has
 * rebound, so the keys can be learned without opening Settings.
 */
export function ShortcutsSheet() {
  const { keyBindings, commands, setView } = useWorkspace();
  const [open, setOpen] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useModalFocus(card, open, close, "[data-autofocus]");
  useEffect(() => {
    const show = () => setOpen((current) => !current);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, show);
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, show);
  }, []);
  if (!open) return null;
  const where = (context: string) => (context === "global" ? "" : ` (${CONTEXT_LABELS[context as keyof typeof CONTEXT_LABELS]})`);
  const rows: Array<{ id: string; label: string; keys: string[][] }> = [
    ...registryRows(keyBindings).flatMap(({ command, bindings }) => {
      if (command.menuOwned) {
        const parsed = parseChordSequence(command.keys);
        return parsed.ok ? [{ id: command.id, label: command.label, keys: sequenceSymbols(parsed.sequence) }] : [];
      }
      return bindings.filter((binding) => !takenByMenu(binding.sequence)).map((binding, index) => ({ id: `${command.id}-${index}`, label: `${command.label}${where(binding.context)}`, keys: sequenceSymbols(binding.sequence) }));
    }),
    ...keyBindings
      .filter((binding) => binding.action.includes(":") && !takenByMenu(binding.sequence))
      .map((binding, index) => ({ id: `custom-${index}`, label: `${actionLabel(binding.action, commands?.list?.commands)}${where(binding.context)}`, keys: sequenceSymbols(binding.sequence) })),
    ...FIXED_SHORTCUTS.map((row) => ({ id: row.label, label: row.label, keys: [row.keys] })),
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
            <div key={row.id} className="shortcuts-row">
              <dt>{row.label}</dt>
              <dd>{row.keys.map((chord, index) => (
                <span key={index} className="shortcut-chord">{chord.map((key, at) => <kbd key={at}>{key}</kbd>)}</span>
              ))}</dd>
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
