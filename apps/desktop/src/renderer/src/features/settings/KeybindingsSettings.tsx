import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  formatChordSequence,
  KEY_COMMAND_GROUPS,
  keymapConflicts,
  KEYMAP_CONTEXTS,
  parseChordSequence,
  pressedSequence,
  SEQUENCE_TIMEOUT_MS,
  takenByMenu,
  type ChordSequence,
  type EffectiveBinding,
  type KeybindingEdit,
  type KeymapConflict,
  type KeymapContext,
} from "@capsule/shared";
import {
  actionLabel,
  chordFromEvent,
  CONTEXT_LABELS,
  isMac,
  registryRows,
  sequenceLabel,
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
    if (event.key === "Escape" && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
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
  description?: string;
  group: string;
  context: KeymapContext;
  bindings: EffectiveBinding[];
  fixed?: ChordSequence;
  /** Something in keybindings.json is about this action here, so Reset has work to do. */
  changed: boolean;
}

const CUSTOM_GROUP = "Your bindings";

/** What stands in a row's way, in words: another action on its keys, or a key that fires before its sequence can finish. */
function conflictNotes(row: Row, conflicts: readonly KeymapConflict[], name: (action: string) => string): string[] {
  return conflicts
    .filter((conflict) => conflict.actions.includes(row.action))
    .map((conflict) => {
      const others = conflict.actions.filter((action) => action !== row.action).map(name).join(" and ");
      const where = conflict.context === "global" ? "" : ` in ${CONTEXT_LABELS[conflict.context]}`;
      if (conflict.kind === "duplicate") return `Shares its keys with ${others}${where}. Only one of them runs.`;
      return conflict.actions[0] === row.action ? `Fires before ${others} can finish${where}.` : `${name(conflict.actions[0]!)} fires before this can finish${where}.`;
    });
}

/**
 * Settings → Shortcuts, read from and written to keybindings.json. Every
 * change edits the file in place and keeps its comments, so the file stays
 * the thing to sync with dotfiles.
 */
export function KeybindingsSettings() {
  const { api, config, keyBindings, commands, project } = useWorkspace();
  const desktop = api.isDesktop === true;
  const mac = isMac();
  const [query, setQuery] = useState("");
  const [keySearch, setKeySearch] = useState<ChordSequence>();
  const [searchingKeys, setSearchingKeys] = useState(false);
  const [recording, setRecording] = useState<string>();
  const [adding, setAdding] = useState<{ action: string; context: KeymapContext }>();
  const [error, setError] = useState<string>();
  const entries = config?.keybindings ?? [];
  const name = (action: string) => actionLabel(action, commands?.list?.commands);

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
        ...(command.description ? { description: command.description } : {}),
        group: command.group,
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
      const row = custom.get(id) ?? { id, action: binding.action, label: actionLabel(binding.action, commands?.list?.commands), group: CUSTOM_GROUP, context: binding.context, bindings: [], changed: true };
      row.bindings.push(binding);
      custom.set(id, row);
    }
    return [...registry, ...custom.values()];
  }, [keyBindings, entries, commands?.list?.commands]);

  const conflicts = useMemo(() => keymapConflicts(keyBindings, mac), [keyBindings, mac]);
  const text = query.trim().toLowerCase();
  const shown = rows.filter((row) => {
    const sequences = row.fixed ? [row.fixed] : row.bindings.map((binding) => binding.sequence);
    if (keySearch?.length) return sequences.some((sequence) => sequenceStartsWith(sequence, keySearch));
    return !text
      || [row.label, row.action, row.description ?? ""].some((field) => field.toLowerCase().includes(text))
      || sequences.some((sequence) => [sequenceLabel(sequence, mac), formatChordSequence(sequence)].some((keys) => keys.toLowerCase().includes(text)));
  });
  const groups = [...KEY_COMMAND_GROUPS, CUSTOM_GROUP]
    .map((group) => ({ group, rows: shown.filter((row) => row.group === group) }))
    .filter((group) => group.rows.length > 0);

  const edit = (change: KeybindingEdit) => {
    setError(undefined);
    void api.keybindingsSet(change).catch((reason: unknown) => setError(formatUserError(reason)));
  };
  /** Who else holds these keys where this row works, so a recording can ask before taking them. */
  const holderOf = (sequence: ChordSequence, context: KeymapContext, action: string) => {
    const keys = pressedSequence(sequence, mac);
    return keyBindings.find((binding) => binding.context === context && binding.action !== action && pressedSequence(binding.sequence, mac) === keys);
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
      <section className="card keybindings-card">
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
            <input className="field-select" value={query} placeholder="Search by name or keys" aria-label="Search shortcuts" onChange={(event) => setQuery(event.target.value)} />
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
            {searchingKeys || keySearch ? "Search by name" : "Record keys to find"}
          </button>
          {desktop && !adding && (
            <button type="button" className="chip" onClick={() => setAdding({ action: actionChoices[0]?.value ?? "", context: "global" })}>
              Add a binding…
            </button>
          )}
        </div>
        {desktop && adding && (
          <AddBinding
            choices={actionChoices}
            value={adding}
            mac={mac}
            holder={(sequence) => holderOf(sequence, adding.context, adding.action)}
            name={name}
            onChange={setAdding}
            onCancel={() => setAdding(undefined)}
            onDone={(sequence) => {
              edit({ op: "bind", action: adding.action, context: adding.context, sequence: formatChordSequence(sequence) });
              setAdding(undefined);
            }}
          />
        )}
        {!desktop && (
          <p className="muted keybindings-note">
            Shortcuts are changed on the computer running Capsule. In a web browser, the browser may take some keys, such as ⌘T or ⌘W, before Capsule sees them.
          </p>
        )}
        {conflicts.length > 0 && (
          <p className="keybindings-conflicts" role="status">
            {conflicts.length === 1 ? "1 conflict" : `${conflicts.length} conflicts`}. The rows involved say what is in the way.
          </p>
        )}
        {error && <p className="settings-keybind-error" role="alert">{error}</p>}
      </section>
      {groups.map(({ group, rows: groupRows }) => (
        <section key={group} className="card keybindings-group" aria-label={group}>
          <h3>{group}</h3>
          {groupRows.map((row) => (
            <ShortcutRow
              key={row.id}
              row={row}
              desktop={desktop}
              mac={mac}
              notes={conflictNotes(row, conflicts, name)}
              recording={recording === row.id}
              holder={(sequence) => holderOf(sequence, row.context, row.action)}
              name={name}
              onRecord={(on) => { setError(undefined); setRecording(on ? row.id : undefined); }}
              onEdit={edit}
            />
          ))}
        </section>
      ))}
      {groups.length === 0 && <section className="card"><p className="muted keybindings-empty">No shortcut matches.</p></section>}
      <p className="muted keybindings-note">
        In the composer, type <span className="mono">/</span> for commands, <span className="mono">@</span> to mention a file, or <span className="mono">$</span> to attach a skill.
      </p>
    </div>
  );
}

/** Keys just recorded that cannot be used as they are: the menu's, or another action's. */
type Pending = { sequence: ChordSequence; problem: "menu" } | { sequence: ChordSequence; problem: "taken"; holder: string };

function usePendingRecording(props: { mac: boolean; holder: (sequence: ChordSequence) => EffectiveBinding | undefined; name: (action: string) => string; save: (sequence: ChordSequence) => void }) {
  const [pending, setPending] = useState<Pending>();
  const check = (sequence: ChordSequence) => {
    if (takenByMenu(sequence, props.mac)) return setPending({ sequence, problem: "menu" });
    const holder = props.holder(sequence);
    if (holder) return setPending({ sequence, problem: "taken", holder: props.name(holder.action) });
    setPending(undefined);
    props.save(sequence);
  };
  const notice = pending && (
    <p className="keybindings-pending" role="alert">
      {pending.problem === "menu"
        ? `${sequenceLabel(pending.sequence.slice(0, 1), props.mac)} belongs to the application menu, which takes it first, so this would never fire. Try other keys.`
        : `${sequenceLabel(pending.sequence, props.mac)} already runs ${pending.holder}. Using it here leaves that with no keys.`}
      {pending.problem === "taken" && <button type="button" className="chip" onClick={() => { props.save(pending.sequence); setPending(undefined); }}>Use it here</button>}
      <button type="button" className="chip" onClick={() => setPending(undefined)}>{pending.problem === "taken" ? "Keep both as they are" : "OK"}</button>
    </p>
  );
  return { check, notice, clear: () => setPending(undefined) };
}

function ShortcutRow({ row, desktop, mac, notes, recording, holder, name, onRecord, onEdit }: {
  row: Row;
  desktop: boolean;
  mac: boolean;
  notes: string[];
  recording: boolean;
  holder: (sequence: ChordSequence) => EffectiveBinding | undefined;
  name: (action: string) => string;
  onRecord: (on: boolean) => void;
  onEdit: (edit: KeybindingEdit) => void;
}) {
  const save = (sequence: ChordSequence) => onEdit({ op: "bind", action: row.action, context: row.context, sequence: formatChordSequence(sequence) });
  const pending = usePendingRecording({ mac, holder, name, save });
  const recorder = useSequenceRecorder((sequence) => {
    onRecord(false);
    pending.check(sequence);
  });
  const dead = row.bindings.filter((binding) => takenByMenu(binding.sequence, mac));
  const editable = !row.fixed && desktop;
  return (
    <div className="setting shortcut-setting">
      <div className="setting-copy">
        <div>
          <span className="setting-label">{row.label}</span>
          {row.context !== "global" && <span className="shortcut-context">{CONTEXT_LABELS[row.context]}</span>}
          {row.changed && !row.fixed && row.group !== CUSTOM_GROUP && <span className="shortcut-context">Changed</span>}
        </div>
        {row.fixed ? <p>Set by the application menu.</p> : row.description ? <p>{row.description}</p> : null}
        {notes.map((note) => <p key={note} className="shortcut-warning">{note}</p>)}
        {dead.map((binding) => (
          <p key={formatChordSequence(binding.sequence)} className="shortcut-warning">
            {sequenceLabel(binding.sequence.slice(0, 1), mac)} belongs to the application menu, so {sequenceLabel(binding.sequence, mac)} never fires.
          </p>
        ))}
        {pending.notice}
      </div>
      <div className="setting-control shortcut-controls">
        {row.changed && editable && (
          <button type="button" className="ghost" title="Put the default keys back" onClick={() => { pending.clear(); onEdit({ op: "reset", action: row.action, context: row.context }); }}>Reset</button>
        )}
        {row.bindings.length > 0 && editable && (
          <button type="button" className="ghost shortcut-unbind" title="Leave this with no keys" onClick={() => row.bindings.forEach((binding) => onEdit({ op: "unbind", context: binding.context, sequence: formatChordSequence(binding.sequence) }))}>
            Unbind
          </button>
        )}
        <button
          type="button"
          className={`shortcut-keys${recording ? " capturing" : ""}`}
          disabled={!editable}
          aria-label={`${row.label}: ${row.fixed ? sequenceLabel(row.fixed, mac) : row.bindings.length ? row.bindings.map((binding) => sequenceLabel(binding.sequence, mac)).join(", ") : "not bound"}${editable ? ". Press to record new keys" : ""}`}
          data-keymap-capture={recording ? "" : undefined}
          title={row.fixed ? "Set by the application menu, which receives this key first." : editable ? "Click, then press one key or two in a row. Esc cancels." : undefined}
          onClick={() => { pending.clear(); onRecord(!recording); }}
          onBlur={() => recording && onRecord(false)}
          onKeyDown={(event) => { if (recording) recorder.onKeyDown(event, () => onRecord(false)); }}
        >
          {recording ? (
            recorder.recorded.length ? <><Keys sequence={recorder.recorded} /><span className="shortcut-capturing">…</span></> : <span className="shortcut-capturing">Press keys…</span>
          ) : row.fixed ? (
            <Keys sequence={row.fixed} />
          ) : row.bindings.length ? (
            row.bindings.map((binding, index) => (
              <span key={index} className={`shortcut-binding${takenByMenu(binding.sequence, mac) ? " is-dead" : ""}`}>
                <Keys sequence={binding.sequence} />
              </span>
            ))
          ) : (
            <span className="shortcut-capturing">Not bound</span>
          )}
        </button>
      </div>
    </div>
  );
}

function AddBinding({ choices, value, mac, holder, name, onChange, onCancel, onDone }: {
  choices: Array<{ value: string; label: string }>;
  value: { action: string; context: KeymapContext };
  mac: boolean;
  holder: (sequence: ChordSequence) => EffectiveBinding | undefined;
  name: (action: string) => string;
  onChange: (value: { action: string; context: KeymapContext }) => void;
  onCancel: () => void;
  onDone: (sequence: ChordSequence) => void;
}) {
  const [recording, setRecording] = useState(false);
  const pending = usePendingRecording({ mac, holder, name, save: onDone });
  const recorder = useSequenceRecorder((sequence) => {
    setRecording(false);
    pending.check(sequence);
  });
  return (
    <>
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
          onClick={() => { pending.clear(); setRecording(!recording); }}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => { if (recording) recorder.onKeyDown(event, () => setRecording(false)); }}
        >
          {recorder.recorded.length ? <Keys sequence={recorder.recorded} /> : <span className="shortcut-capturing">{recording ? "Press keys…" : "Record keys"}</span>}
        </button>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
      </div>
      {pending.notice}
    </>
  );
}
