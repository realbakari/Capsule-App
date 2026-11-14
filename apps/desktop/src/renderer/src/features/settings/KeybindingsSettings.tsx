import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  formatChordSequence,
  keymapConflicts,
  KEYMAP_CONTEXTS,
  parseChordSequence,
  SEQUENCE_TIMEOUT_MS,
  takenByMenu,
  type ChordSequence,
  type EffectiveBinding,
  type KeybindingEdit,
  type KeymapContext,
} from "@capsule/shared";
import {
  actionLabel,
  chordFromEvent,
  CONTEXT_LABELS,
  registryRows,
  sequenceStartsWith,
  sequenceSymbols,
} from "../../lib/keybindings";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import "./keybindings.css";

/**
 * Records one or two chords. After the first, a second key within 1.5 s
 * makes a sequence; otherwise the single chord stands. Escape cancels.
 */
function useSequenceRecorder(onDone: (sequence: ChordSequence) => void) {
  const [recorded, setRecorded] = useState<ChordSequence>([]);
  const timer = useRef<number | undefined>(undefined);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const finish = (sequence: ChordSequence) => {
    window.clearTimeout(timer.current);
    setRecorded([]);
    if (sequence.length) done.current(sequence);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, cancel: () => void) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.metaKey && !event.ctrlKey) {
      window.clearTimeout(timer.current);
      setRecorded([]);
      cancel();
      return;
    }
    const chord = chordFromEvent(event.nativeEvent);
    if (!chord) return;
    const next = [...recorded, chord];
    if (next.length === 2) return finish(next);
    setRecorded(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => finish(next), SEQUENCE_TIMEOUT_MS);
  };
  return { recorded, onKeyDown };
}

function Keys({ sequence }: { sequence: ChordSequence }) {
  return (
    <>
      {sequenceSymbols(sequence).map((chord, index) => (
        <span key={index} className="shortcut-chord">{chord.map((symbol, at) => <kbd key={at}>{symbol}</kbd>)}</span>
      ))}
    </>
  );
}

interface Row {
  id: string;
  action: string;
  label: string;
  context: KeymapContext;
  bindings: EffectiveBinding[];
  fixed?: ChordSequence;
  /** Something in keybindings.json is about this action here, so Reset has work to do. */
  changed: boolean;
}

/**
 * Settings → Shortcuts, read from and written to keybindings.json. Every
 * change edits the file in place and keeps its comments, so the file stays
 * the thing to sync with dotfiles.
 */
export function KeybindingsSettings() {
  const { api, config, keyBindings, commands, project } = useWorkspace();
  const desktop = api.isDesktop === true;
  const [query, setQuery] = useState("");
  const [keySearch, setKeySearch] = useState<ChordSequence>();
  const [searchingKeys, setSearchingKeys] = useState(false);
  const [recording, setRecording] = useState<string>();
  const [adding, setAdding] = useState<{ action: string; context: KeymapContext }>();
  const [error, setError] = useState<string>();
  const entries = config?.keybindings ?? [];

  const rows = useMemo<Row[]>(() => {
    const touched = (action: string, context: KeymapContext) => entries.some((entry) => entry.context === context && entry.action === action);
    const unbound = (binding: { sequence: ChordSequence; context: KeymapContext }) =>
      entries.some((entry) => entry.action === null && entry.context === binding.context && formatChordSequence(entry.sequence) === formatChordSequence(binding.sequence));
    const registry = registryRows(keyBindings).map(({ command, bindings }): Row => {
      const fixed = command.menuOwned ? parseChordSequence(command.keys) : undefined;
      const defaultKeys = parseChordSequence(command.keys);
      return {
        id: command.id,
        action: command.id,
        label: command.label,
        context: command.context,
        bindings,
        ...(fixed?.ok ? { fixed: fixed.sequence } : {}),
        changed: touched(command.id, command.context) || (defaultKeys.ok && unbound({ sequence: defaultKeys.sequence, context: command.context })),
      };
    });
    const custom = new Map<string, Row>();
    for (const binding of keyBindings) {
      if (!binding.action.includes(":")) continue;
      const id = `${binding.context} ${binding.action}`;
      const row = custom.get(id) ?? { id, action: binding.action, label: actionLabel(binding.action, commands?.list?.commands), context: binding.context, bindings: [], changed: true };
      row.bindings.push(binding);
      custom.set(id, row);
    }
    return [...registry, ...custom.values()];
  }, [keyBindings, entries, commands?.list?.commands]);

  const conflicts = useMemo(() => keymapConflicts(keyBindings), [keyBindings]);
  const shown = rows.filter((row) => {
    if (keySearch?.length) return row.bindings.some((binding) => sequenceStartsWith(binding.sequence, keySearch)) || Boolean(row.fixed && sequenceStartsWith(row.fixed, keySearch));
    const text = query.trim().toLowerCase();
    return !text || row.label.toLowerCase().includes(text) || row.action.toLowerCase().includes(text);
  });

  const edit = (change: KeybindingEdit) => {
    setError(undefined);
    void api.keybindingsSet(change).catch((reason: unknown) => setError(formatUserError(reason)));
  };
  const searchRecorder = useSequenceRecorder((sequence) => {
    setKeySearch(sequence);
    setSearchingKeys(false);
  });
  const actionChoices = [
    ...registryRows([]).filter(({ command }) => !command.menuOwned).map(({ command }) => ({ value: command.id, label: command.label })),
    ...(commands?.list?.commands ?? []).map((command) => ({ value: `command:${command.name}`, label: `/${command.name}` })),
    ...(project?.actions ?? []).map((action) => ({ value: `action:${action.name}`, label: `Run ${action.name}` })),
  ];

  return (
    <div className="appearance-page">
      <div className="card keybindings-card">
        <div className="keybindings-head">
          <div>
            <h3>Key bindings</h3>
            <p className="muted">
              Saved in keybindings.json. Click a shortcut and press one key, or two in a row for a sequence. Menu shortcuts are fixed.
            </p>
          </div>
          <button type="button" className="ghost" disabled={!desktop} onClick={() => void api.configOpenFile({ kind: "keybindings" }).catch((reason: unknown) => setError(formatUserError(reason)))}>
            Open keybindings.json
          </button>
        </div>
        <div className="keybindings-search">
          {searchingKeys || keySearch ? (
            <div
              className={`field-select keybindings-keysearch${searchingKeys ? " capturing" : ""}`}
              tabIndex={0}
              role="textbox"
              aria-label="Search by keys"
              data-keymap-capture
              ref={(node) => { if (searchingKeys) node?.focus(); }}
              onClick={() => setSearchingKeys(true)}
              onBlur={() => setSearchingKeys(false)}
              onKeyDown={(event) => searchingKeys ? searchRecorder.onKeyDown(event, () => setSearchingKeys(false)) : undefined}
            >
              {searchRecorder.recorded.length ? <Keys sequence={searchRecorder.recorded} /> : keySearch && !searchingKeys ? <Keys sequence={keySearch} /> : <span className="muted">Press the keys to find…</span>}
            </div>
          ) : (
            <input className="field-select" value={query} placeholder="Search shortcuts" aria-label="Search shortcuts" onChange={(event) => setQuery(event.target.value)} />
          )}
          <button
            type="button"
            className={`chip${searchingKeys || keySearch ? " active" : ""}`}
            onClick={() => {
              if (searchingKeys || keySearch) {
                setSearchingKeys(false);
                setKeySearch(undefined);
              } else {
                setQuery("");
                setSearchingKeys(true);
              }
            }}
          >
            {searchingKeys || keySearch ? "Search by name" : "Search by keys"}
          </button>
        </div>
        {conflicts.length > 0 && (
          <div className="keybindings-conflicts" role="status">
            <strong>{conflicts.length === 1 ? "1 conflict" : `${conflicts.length} conflicts`}</strong>
            <ul>
              {conflicts.map((conflict) => (
                <li key={`${conflict.context}-${conflict.kind}-${conflict.sequence}`}>
                  <span className="mono">{conflict.sequence}</span>{" "}
                  {conflict.kind === "duplicate"
                    ? `runs ${conflict.actions.map((action) => actionLabel(action, commands?.list?.commands)).join(" and ")}`
                    : `fires ${actionLabel(conflict.actions[0]!, commands?.list?.commands)} before ${conflict.actions.slice(1).map((action) => actionLabel(action, commands?.list?.commands)).join(", ")} can finish`}
                  {conflict.context !== "global" ? ` in ${CONTEXT_LABELS[conflict.context]}` : ""}.
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className="settings-keybind-error" role="alert">{error}</p>}
        <div className="shortcuts-list">
          {shown.map((row) => (
            <ShortcutRow
              key={row.id}
              row={row}
              desktop={desktop}
              recording={recording === row.id}
              onRecord={(on) => { setError(undefined); setRecording(on ? row.id : undefined); }}
              onEdit={edit}
            />
          ))}
          {shown.length === 0 && <p className="muted keybindings-empty">No shortcut matches.</p>}
        </div>
        {desktop && (
          adding ? (
            <AddBinding
              choices={actionChoices}
              value={adding}
              onChange={setAdding}
              onCancel={() => setAdding(undefined)}
              onDone={(sequence) => {
                edit({ op: "bind", action: adding.action, context: adding.context, sequence: formatChordSequence(sequence) });
                setAdding(undefined);
              }}
            />
          ) : (
            <button type="button" className="ghost keybindings-add" onClick={() => setAdding({ action: actionChoices[0]?.value ?? "", context: "global" })}>
              Add a binding…
            </button>
          )
        )}
        {!desktop && <p className="muted keybindings-note">Changing shortcuts is available in the desktop app.</p>}
        <p className="muted keybindings-note">
          In the composer, type <span className="mono">/</span> for commands, <span className="mono">@</span> to mention a file, or <span className="mono">$</span> to attach a skill.
        </p>
      </div>
    </div>
  );
}

function ShortcutRow({ row, desktop, recording, onRecord, onEdit }: {
  row: Row;
  desktop: boolean;
  recording: boolean;
  onRecord: (on: boolean) => void;
  onEdit: (edit: KeybindingEdit) => void;
}) {
  const recorder = useSequenceRecorder((sequence) => {
    onRecord(false);
    onEdit({ op: "bind", action: row.action, context: row.context, sequence: formatChordSequence(sequence) });
  });
  const first = row.bindings[0];
  return (
    <div className="shortcut-row">
      <span className="shortcut-label">
        {row.label}
        {row.context !== "global" && <span className="shortcut-context">{CONTEXT_LABELS[row.context]}</span>}
      </span>
      <span className="shortcut-controls">
        {row.changed && !row.fixed && desktop && (
          <button type="button" className="ghost" onClick={() => onEdit({ op: "reset", action: row.action, context: row.context })}>Reset</button>
        )}
        {first && !row.fixed && desktop && (
          <button type="button" className="ghost shortcut-unbind" onClick={() => row.bindings.forEach((binding) => onEdit({ op: "unbind", context: binding.context, sequence: formatChordSequence(binding.sequence) }))}>
            Unbind
          </button>
        )}
        <button
          type="button"
          className={`shortcut-keys${recording ? " capturing" : ""}`}
          disabled={Boolean(row.fixed) || !desktop}
          data-keymap-capture={recording ? "" : undefined}
          title={row.fixed ? "Set by the application menu, which receives this key first." : "Click, then press one key or two in a row"}
          onClick={() => onRecord(!recording)}
          onBlur={() => recording && onRecord(false)}
          onKeyDown={(event) => { if (recording) recorder.onKeyDown(event, () => onRecord(false)); }}
        >
          {recording ? (
            recorder.recorded.length ? <><Keys sequence={recorder.recorded} /><span className="shortcut-capturing">…</span></> : <span className="shortcut-capturing">Press keys…</span>
          ) : row.fixed ? (
            <Keys sequence={row.fixed} />
          ) : row.bindings.length ? (
            row.bindings.map((binding, index) => (
              <span key={index} className={`shortcut-binding${takenByMenu(binding.sequence) ? " is-dead" : ""}`} title={takenByMenu(binding.sequence) ? "The application menu takes the first key, so this never fires." : undefined}>
                <Keys sequence={binding.sequence} />
              </span>
            ))
          ) : (
            <span className="shortcut-capturing">Not bound</span>
          )}
        </button>
      </span>
    </div>
  );
}

function AddBinding({ choices, value, onChange, onCancel, onDone }: {
  choices: Array<{ value: string; label: string }>;
  value: { action: string; context: KeymapContext };
  onChange: (value: { action: string; context: KeymapContext }) => void;
  onCancel: () => void;
  onDone: (sequence: ChordSequence) => void;
}) {
  const [recording, setRecording] = useState(false);
  const recorder = useSequenceRecorder((sequence) => {
    setRecording(false);
    onDone(sequence);
  });
  return (
    <div className="keybindings-add-row">
      <select className="field-select" aria-label="Action" value={value.action} onChange={(event) => onChange({ ...value, action: event.target.value })}>
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
      <select className="field-select" aria-label="Where" value={value.context} onChange={(event) => onChange({ ...value, context: event.target.value as KeymapContext })}>
        {KEYMAP_CONTEXTS.map((context) => <option key={context} value={context}>{CONTEXT_LABELS[context]}</option>)}
      </select>
      <button
        type="button"
        className={`shortcut-keys${recording ? " capturing" : ""}`}
        data-keymap-capture={recording ? "" : undefined}
        disabled={!value.action}
        onClick={() => setRecording(!recording)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => { if (recording) recorder.onKeyDown(event, () => setRecording(false)); }}
      >
        {recorder.recorded.length ? <Keys sequence={recorder.recorded} /> : <span className="shortcut-capturing">{recording ? "Press keys…" : "Record keys"}</span>}
      </button>
      <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
