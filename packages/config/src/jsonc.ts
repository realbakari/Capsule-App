import { readFileSync, statSync } from "node:fs";
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import { writeFileAtomic } from "@capsule/filesystem";

export interface JsoncError {
  message: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

/** A JSONC file as found on disk. */
export type JsoncFile =
  | { state: "missing" }
  | { state: "ok"; text: string; value: unknown }
  | { state: "broken"; text: string; error: JsoncError };

/** One change to a top-level key. `undefined` removes the key. */
export interface JsoncEdit {
  key: string;
  value: unknown;
}

const MAX_BYTES = 1024 * 1024;
const FORMAT = { insertSpaces: true, tabSize: 2, eol: "\n" } as const;

export function readJsonc(file: string): JsoncFile {
  let text: string;
  try {
    if (statSync(file).size > MAX_BYTES) {
      return { state: "broken", text: "", error: { message: "The file is larger than 1 MB.", line: 1, column: 1 } };
    }
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { state: "missing" };
    return { state: "broken", text: "", error: { message: `Could not read the file (${code ?? "unknown error"}).`, line: 1, column: 1 } };
  }
  return parseJsonc(text);
}

export function parseJsonc(text: string): JsoncFile {
  if (!text.trim()) return { state: "ok", text, value: {} };
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const first = errors[0];
  if (!first) return { state: "ok", text, value };
  return { state: "broken", text, error: { message: describeError(first), ...position(text, first.offset) } };
}

/** Apply edits to a file's text, keeping its comments and formatting. */
export function editJsonc(text: string, edits: readonly JsoncEdit[]): string {
  let next = text.trim() ? text : "{}\n";
  for (const edit of edits) {
    next = applyEdits(next, modify(next, [edit.key], edit.value, { formattingOptions: FORMAT }));
  }
  return next;
}

export function writeJsonc(file: string, text: string): void {
  writeFileAtomic(file, text.endsWith("\n") ? text : `${text}\n`);
}

function describeError(error: ParseError): string {
  const words = printParseErrorCode(error.error).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
}

function position(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split("\n");
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}
