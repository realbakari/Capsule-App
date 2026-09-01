import { useState } from "react";
import type { CapsuleSettings } from "@capsule/shared";
import {
  COMMANDS,
  chordFor,
  chordSymbols,
  conflictsFor,
  formatChord,
  parseChord,
  type KeyChord,
  type Keymap,
} from "../../lib/keybindings";

/**
 * Editable shortcuts, rendered from the same registry the key handler
 * dispatches from, so the list cannot drift from what the keys actually do.
 *
 * Menu-owned commands are shown but not editable: their accelerators are
 * declared by the application menu in the main process, which sees the key
 * before the web contents does. Showing them as rebindable here would produce
 * a control that appears to work and changes nothing.
 */
export function KeybindingsSettings({
  settings,
  onPatch,
}: {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void;
}) {
  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const keymap: Keymap = {};
  for (const [id, value] of Object.entries(settings.keybindings ?? {})) {
    const chord = parseChord(value);
    if (chord) keymap[id] = chord;
  }

  function commit(id: string, chord: KeyChord) {
    const clash = conflictsFor(id, chord, keymap);
    if (clash.length > 0) {
      // Refusing is better than silently stealing another command's keys.
      setError(`${chordSymbols(chord).join("")} is already ${clash[0]!.label}.`);
      return;
    }
    setError(null);
    setCapturing(null);
    onPatch({ keybindings: { ...(settings.keybindings ?? {}), [id]: formatChord(chord) } });
  }

  function reset(id: string) {
    const next = { ...(settings.keybindings ?? {}) };
    delete next[id];
    setError(null);
    onPatch({ keybindings: next });
  }

  return (
    <div className="appearance-page">
      <div className="card">
        <h3>Shortcuts</h3>
        <p className="muted">
          Click a shortcut and press the keys you want. Shortcuts marked as menu items are set by
          the application menu and cannot be changed here.
        </p>
        {error && <p className="settings-keybind-error">{error}</p>}
        <div className="shortcuts-list">
          {COMMANDS.map((command) => {
            const chord = chordFor(command, keymap);
            const overridden = Boolean(settings.keybindings?.[command.id]);
            const isCapturing = capturing === command.id;
            return (
              <div className="shortcut-row" key={command.id}>
                <span className="shortcut-label">{command.label}</span>
                <span className="shortcut-controls">
                  {overridden && !command.menuOwned && (
                    <button type="button" className="ghost" onClick={() => reset(command.id)}>
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    className={`shortcut-keys${isCapturing ? " capturing" : ""}`}
                    disabled={command.menuOwned}
                    title={
                      command.menuOwned
                        ? "Set by the application menu, which receives this key first."
                        : "Click, then press the keys you want"
                    }
                    onClick={() => {
                      setError(null);
                      setCapturing(isCapturing ? null : command.id);
                    }}
                    onKeyDown={(event) => {
                      if (!isCapturing) return;
                      event.preventDefault();
                      if (event.key === "Escape") {
                        setCapturing(null);
                        return;
                      }
                      // A modifier on its own is not a chord yet — keep listening.
                      if (["Meta", "Shift", "Alt", "Control"].includes(event.key)) return;
                      commit(command.id, {
                        key: event.key.toLowerCase(),
                        meta: event.metaKey || event.ctrlKey,
                        shift: event.shiftKey,
                        alt: event.altKey,
                      });
                    }}
                  >
                    {isCapturing ? (
                      <span className="shortcut-capturing">Press keys…</span>
                    ) : (
                      chordSymbols(chord).map((symbol, index) => <kbd key={index}>{symbol}</kbd>)
                    )}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          In the composer, type <span className="mono">/</span> for commands,{" "}
          <span className="mono">@</span> to mention a file, or <span className="mono">$</span> to
          attach a skill.
        </p>
      </div>
    </div>
  );
}
