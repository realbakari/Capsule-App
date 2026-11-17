import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BINARY_MISS_TTL_MS,
  clearBinaryCache,
  harnessBinaries,
  launchExecutable,
  launchExtras,
  presetFor,
  recheckMissingBinaries,
  setAgentOverrides,
  whichBinary,
} from "./index.js";

let dir: string;
let originalPath: string | undefined;

function install(name: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, 0o755);
  return file;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "capsule-lookup-"));
  originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath ?? ""}`;
  clearBinaryCache();
  setAgentOverrides(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  process.env.PATH = originalPath;
  clearBinaryCache();
  setAgentOverrides(undefined);
  rmSync(dir, { recursive: true, force: true });
});

describe("binary lookup", () => {
  it.skipIf(process.platform === "win32")("looks again for a missing agent once the miss is old, without a Doctor run", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const name = `capsule-fixture-${process.pid}`;
    expect(whichBinary([name])).toBeUndefined();
    const file = install(name);
    expect(whichBinary([name])).toBeUndefined();
    vi.setSystemTime(Date.now() + BINARY_MISS_TTL_MS + 1);
    expect(whichBinary([name])).toBe(file);
  });

  it.skipIf(process.platform === "win32")("finds a newly installed agent on recheck and keeps a found path cached", () => {
    const name = `capsule-fixture-recheck-${process.pid}`;
    expect(whichBinary([name])).toBeUndefined();
    expect(recheckMissingBinaries()).toBe(false);
    const file = install(name);
    expect(recheckMissingBinaries()).toBe(true);
    expect(whichBinary([name])).toBe(file);
  });
});

describe("agent overrides", () => {
  const claude = presetFor("claude")!;

  it("launches the binary the user set, for both the launch command and its sign-in probe", () => {
    const own = install("claude-work");
    setAgentOverrides({ claude: { binaryPath: own } });
    expect(harnessBinaries(claude, true)).toEqual({ login: own, launch: own });
    expect(launchExecutable("claude", "claude")).toBe(own);
    /* Another preset's command is never rewritten by Claude's override. */
    expect(launchExecutable("claude", "codex")).not.toBe(own);
  });

  it("reports a binary path that points at nothing instead of quietly using another copy", () => {
    setAgentOverrides({ claude: { binaryPath: path.join(dir, "missing") } });
    const found = harnessBinaries(claude, true);
    expect(found.launch).toBeUndefined();
    expect(found.overrideMissing).toBe(path.join(dir, "missing"));
  });

  it("adds the user's arguments and environment, with ~/ expanded", () => {
    setAgentOverrides({ claude: { args: ["--verbose"], env: { CLAUDE_CONFIG_DIR: "~/.claude-work" } } });
    expect(launchExtras("claude")).toEqual({ args: ["--verbose"], env: { CLAUDE_CONFIG_DIR: path.join(os.homedir(), ".claude-work") } });
    expect(launchExtras("codex")).toEqual({ args: [] });
  });
});
