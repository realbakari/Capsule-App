import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentInstallProgress } from "@capsule/shared";
import { createAgentStore, type UserCopyIo } from "./service.js";

/*
 * Updating a copy the user installed, end to end through the store with every
 * process and network call faked: nothing here may run a real package manager.
 */
const PREFIX = "/fixture/node";
const CLAUDE = `${PREFIX}/bin/claude`;
const REAL = `${PREFIX}/lib/node_modules/@anthropic-ai/claude-code/cli.js`;

let agentsDir: string;
let progress: AgentInstallProgress[];
let installed: string;
let latest: string | undefined;
let runs: Array<{ file: string; args: string[]; path?: string }>;
let fetched: string[];

beforeEach(() => {
  agentsDir = mkdtempSync(path.join(os.tmpdir(), "capsule-store-"));
  progress = [];
  installed = "2.0.0";
  latest = "2.1.0";
  runs = [];
  fetched = [];
});

afterEach(() => rmSync(agentsDir, { recursive: true, force: true }));

function store(options: { exitCode?: number; npmBesidePrefix?: boolean; online?: boolean } = {}) {
  const copyIo: UserCopyIo = {
    realPath: async (file) => (file === CLAUDE ? REAL : file),
    packageVersion: async () => installed,
    versionOutput: async () => undefined,
  };
  const fetchImpl: typeof fetch = async (url) => {
    fetched.push(String(url));
    if (options.online === false) throw new TypeError("fetch failed");
    if (String(url).includes("registry.npmjs.org")) return Response.json({ latest });
    return Response.json({ agents: [] });
  };
  return createAgentStore({
    agentsDir,
    emit: (item) => progress.push(item),
    host: () => ({ platform: "darwin", arch: "arm64", hasNode: true }),
    userPath: (command) => (command === "claude" ? CLAUDE : undefined),
    tools: () => ({ exists: (file) => options.npmBesidePrefix !== false && file === `${PREFIX}/bin/npm` }),
    copyIo,
    changed: () => undefined,
    fetch: fetchImpl,
    platform: "darwin",
    run: async (file, args, { env }) => {
      runs.push({ file, args, path: env?.PATH });
      if (!options.exitCode) installed = latest!;
      return { code: options.exitCode ?? 0, stderr: options.exitCode ? "npm ERR! EACCES: permission denied\n" : "" };
    },
  });
}

const claudeEntry = async (agents: ReturnType<typeof store>) => (await agents.list()).find((item) => item.harnessId === "claude")!;

describe("a copy the user installed", () => {
  it("shows its version and the update its owner would run", async () => {
    expect((await claudeEntry(store())).user).toEqual({
      path: CLAUDE, version: "2.0.0", latest: "2.1.0",
      update: { via: "npm", command: "npm install -g @anthropic-ai/claude-code@2.1.0", oneClick: true },
    });
  });

  it("runs that update with the npm beside its prefix, reports progress, and reads the new version back", async () => {
    const agents = store();
    const entry = await agents.updateUserCopy("claude");
    expect(runs).toEqual([{ file: `${PREFIX}/bin/npm`, args: ["install", "-g", "--prefix", PREFIX, "@anthropic-ai/claude-code@2.1.0"], path: expect.stringMatching(/^\/fixture\/node\/bin/) }]);
    expect(progress.map((item) => item.phase)).toEqual(["updating", "done"]);
    expect(progress.at(-1)).toEqual({ harnessId: "claude", phase: "done", version: "2.1.0" });
    expect(entry.user).toEqual({ path: CLAUDE, version: "2.1.0", latest: "2.1.0" });
  });

  it("refuses to run anything when it cannot tell which npm owns the copy, and says what to run", async () => {
    await expect(store({ npmBesidePrefix: false }).updateUserCopy("claude")).rejects.toThrow("Run `npm install -g @anthropic-ai/claude-code@2.1.0` in a terminal.");
    expect(runs).toEqual([]);
  });

  it("reports a failed update in a sentence and leaves the version as it was", async () => {
    const agents = store({ exitCode: 1 });
    await expect(agents.updateUserCopy("claude")).rejects.toThrow("Claude Code didn't update. npm ERR! EACCES: permission denied");
    expect(progress.at(-1)).toMatchObject({ phase: "failed" });
    expect((await claudeEntry(agents)).user?.version).toBe("2.0.0");
  });

  it("offers no update when it is current, or when the latest release cannot be looked up", async () => {
    latest = "2.0.0";
    expect((await claudeEntry(store())).user?.update).toBeUndefined();
    latest = "2.1.0";
    const offline = await claudeEntry(store({ online: false }));
    expect(offline.user).toEqual({ path: CLAUDE, version: "2.0.0" });
    await expect(store({ online: false }).updateUserCopy("claude")).rejects.toThrow("already up to date");
    expect(runs).toEqual([]);
  });

  it("looks the latest release up once, not once per list", async () => {
    const agents = store();
    await agents.list();
    await agents.list();
    expect(fetched.filter((url) => url.includes("claude-code")).length).toBe(1);
  });
});
