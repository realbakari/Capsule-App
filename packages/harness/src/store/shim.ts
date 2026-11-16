import { safeAgentEnv } from "@capsule/shared";

/*
 * A shim is a tiny launcher named after the preset's command. Binary lookup
 * finds it in the managed bin folder, so the agent starts exactly as a copy
 * on PATH would.
 */
export interface ShimSpec {
  target: string;
  env: Record<string, string>;
  /** A folder searched after the user's PATH, for npm installs whose launcher needs `node`. */
  pathAfter?: string;
}

export function shimFileName(command: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? `${command}.cmd` : command;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function posixShim(spec: ShimSpec): string {
  const lines = ["#!/bin/sh"];
  for (const [key, value] of Object.entries(safeAgentEnv(spec.env))) lines.push(`export ${key}=${shQuote(value)}`);
  if (spec.pathAfter) lines.push(`export PATH="$PATH":${shQuote(spec.pathAfter)}`);
  lines.push(`exec ${shQuote(spec.target)} "$@"`, "");
  return lines.join("\n");
}

/** Inside `set "K=V"` only `%` still expands; a quote or line break cannot be written safely, so that value is dropped. */
function cmdValue(value: string): string | undefined {
  return /["\r\n]/.test(value) ? undefined : value.replace(/%/g, "%%");
}

export function windowsShim(spec: ShimSpec): string {
  const lines = ["@echo off"];
  for (const [key, value] of Object.entries(safeAgentEnv(spec.env))) {
    const safe = cmdValue(value);
    if (safe !== undefined) lines.push(`set "${key}=${safe}"`);
  }
  const after = spec.pathAfter && cmdValue(spec.pathAfter);
  if (after) lines.push(`set "PATH=%PATH%;${after}"`);
  lines.push(`"${spec.target.replace(/%/g, "%%")}" %*`, "");
  return lines.join("\r\n");
}

export function renderShim(spec: ShimSpec, platform: NodeJS.Platform): string {
  return platform === "win32" ? windowsShim(spec) : posixShim(spec);
}
