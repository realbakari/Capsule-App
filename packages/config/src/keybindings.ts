import { applyEdits, modify, parse } from "jsonc-parser";
import {
  defaultBindings,
  formatChordSequence,
  keybindingWarnings,
  parseChordSequence,
  parseKeybindingsFile,
  resolveKeymap,
  type ConfigProblem,
  type KeybindingEdit,
  type KeybindingEntry,
} from "@capsule/shared";
import type { JsoncFile } from "./jsonc.js";

const FORMAT = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

/** keybindings.json's entries, and each entry that cannot do what it says. */
export function readKeybindings(file: JsoncFile, path: string, commands?: readonly string[], profiles?: readonly string[]): { entries: KeybindingEntry[]; problems: ConfigProblem[] } {
  if (file.state !== "ok") return { entries: [], problems: [] };
  const { entries, problems } = parseKeybindingsFile(file.value);
  return {
    entries,
    problems: [
      ...problems.map((problem): ConfigProblem => ({ severity: "error", path, ...(problem.key ? { key: problem.key } : {}), message: problem.message })),
      ...keybindingWarnings(entries, { commands, profiles }).map((problem): ConfigProblem => ({ severity: "warning", path, key: problem.key, message: problem.message })),
    ],
  };
}

interface Block {
  index: number;
  context: string;
  bindings: Record<string, unknown>;
}

function blocksOf(text: string): Block[] {
  const value: unknown = parse(text, [], { allowTrailingComma: true });
  if (!Array.isArray(value)) throw new Error("keybindings.json must be a list of { context, bindings } blocks. Fix it before Capsule writes to it.");
  return value.flatMap((block, index): Block[] => {
    if (typeof block !== "object" || block === null || Array.isArray(block)) return [];
    const record = block as Record<string, unknown>;
    const bindings = record.bindings;
    if (typeof bindings !== "object" || bindings === null || Array.isArray(bindings)) return [];
    return [{ index, context: typeof record.context === "string" ? record.context : "global", bindings: bindings as Record<string, unknown> }];
  });
}

function canonical(text: string): string | undefined {
  const parsed = parseChordSequence(text);
  return parsed.ok ? formatChordSequence(parsed.sequence) : undefined;
}

function set(text: string, path: Array<string | number>, value: unknown, insert = false): string {
  return applyEdits(text, modify(text, path, value, { formattingOptions: FORMAT, ...(insert ? { isArrayInsertion: true } : {}) }));
}

/** Remove every binding in `context` that `drop` matches. */
function removeWhere(text: string, context: string, drop: (key: string | undefined, action: unknown) => boolean): string {
  let next = text;
  for (const block of blocksOf(next)) {
    if (block.context !== context) continue;
    for (const [key, action] of Object.entries(block.bindings)) {
      if (drop(canonical(key), action)) next = set(next, [block.index, "bindings", key], undefined);
    }
  }
  return next;
}

function setBinding(text: string, context: string, sequence: string, action: string | null): string {
  const target = blocksOf(text).find((block) => block.context === context);
  if (target) return set(text, [target.index, "bindings", sequence], action);
  const count = (parse(text, [], { allowTrailingComma: true }) as unknown[]).length;
  return set(text, [count], { context, bindings: { [sequence]: action } }, true);
}

/**
 * keybindings.json's text after one edit, its comments kept. A binding is
 * written in canonical spelling, so the file never holds two spellings of one
 * sequence.
 */
export function editKeybindingsText(text: string, edit: KeybindingEdit): string {
  const start = text.trim() ? text : "[]\n";
  if (edit.op === "reset") {
    const defaults = defaultBindings().filter((binding) => binding.id === edit.action && binding.context === edit.context).map((binding) => formatChordSequence(binding.sequence));
    return removeWhere(start, edit.context, (key, action) => action === edit.action || (action === null && key !== undefined && defaults.includes(key)));
  }
  const sequence = canonical(edit.sequence);
  if (!sequence) throw new Error(`"${edit.sequence}" is not a key sequence.`);
  if (edit.op === "bind") {
    const cleared = removeWhere(start, edit.context, (key, action) => key === sequence || action === edit.action);
    return setBinding(cleared, edit.context, sequence, edit.action);
  }
  const cleared = removeWhere(start, edit.context, (key) => key === sequence);
  const { entries } = parseKeybindingsFile(parse(cleared, [], { allowTrailingComma: true }));
  const stillHeld = resolveKeymap(defaultBindings(), entries).some((binding) => binding.context === edit.context && formatChordSequence(binding.sequence) === sequence);
  return stillHeld ? setBinding(cleared, edit.context, sequence, null) : cleared;
}
