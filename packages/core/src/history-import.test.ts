import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { importContinuation, PRESET_HARNESSES } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";
import { claudeHistory, claudeProjectSlug, codexHistory } from "./history-parsers.js";

vi.setConfig({ testTimeout: 60_000 });

const CLAUDE_ID = "0f3c2a1e-5b7d-4c9e-8a21-6d4f0b9e1c22";
const CODEX_ID = "7a1d9e40-2c3b-4f56-9e8d-0b1c2d3e4f50";

function fixture(name: string, cwd: string): string {
  return readFileSync(fileURLToPath(new URL(`./fixtures/history/${name}`, import.meta.url)), "utf8").replaceAll("__CWD__", cwd);
}

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A home folder holding one Claude Code session and one Codex rollout for `project`. */
function seedHome(home: string, project: string): void {
  const claudeDir = path.join(home, ".claude", "projects", claudeProjectSlug(project));
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(path.join(claudeDir, `${CLAUDE_ID}.jsonl`), fixture("claude-session.jsonl", project));
  const codexDir = path.join(home, ".codex", "sessions", "2026", "11", "03");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(path.join(codexDir, `rollout-2026-11-03T08-00-00-${CODEX_ID}.jsonl`), fixture("codex-rollout.jsonl", project));
  writeFileSync(path.join(codexDir, "rollout-2026-11-03T09-00-00-other.jsonl"), fixture("codex-rollout.jsonl", "/somewhere/else").replace(CODEX_ID, "other"));
}

async function setup(options: { mock: boolean }) {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-import-")));
  const home = path.join(dir, "home");
  const project = path.join(dir, "project");
  mkdirSync(project, { recursive: true });
  seedHome(home, project);
  vi.stubEnv("HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(home, ".claude"));
  vi.stubEnv("CODEX_HOME", path.join(home, ".codex"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, ...(options.mock ? { autoConnect: false } : {}) });
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cleanups.push(() => engine.stop());
  await engine.start();
  const created = engine.createProject({ name: "Fixture", workingDirectory: project });
  return { dir, home, project, engine, projectId: created.id };
}

describe("history parsers", () => {
  it("reads Claude Code prompts and final replies, skipping meta, commands, tool results, sidechains and bad lines", () => {
    const parsed = claudeHistory.parse(fixture("claude-session.jsonl", "/repo").split("\n"), `${CLAUDE_ID}.jsonl`)!;
    expect(parsed).toMatchObject({ nativeSessionId: CLAUDE_ID, cwd: "/repo", title: "Verbose flag", skipped: 1, lastActivity: "2026-11-02T10:00:30.000Z" });
    expect(parsed.turns).toEqual([
      { prompt: "Add a --verbose flag to the CLI", reply: "Added --verbose. It sets the log level to debug.", at: "2026-11-01T09:01:00.000Z" },
      { prompt: "Now write a test for it", reply: "Wrote cli.test.ts. It passes.", at: "2026-11-02T10:00:00.000Z" },
    ]);
  });

  it("reads Codex rollouts from their event messages, not the injected environment context", () => {
    const parsed = codexHistory.parse(fixture("codex-rollout.jsonl", "/repo").split("\n"), "rollout.jsonl")!;
    expect(parsed).toMatchObject({ nativeSessionId: CODEX_ID, cwd: "/repo", skipped: 1 });
    expect(parsed.turns.map(({ prompt, reply }) => ({ prompt, reply }))).toEqual([
      { prompt: "Rename the config loader", reply: "Renamed loadConfig to readConfig in three files." },
      { prompt: "Thanks, now update the docs", reply: "Updated the README." },
    ]);
  });

  it("falls back to response items for a rollout without event messages", () => {
    const lines = fixture("codex-rollout.jsonl", "/repo").split("\n").filter((line) => !line.includes("\"event_msg\""));
    expect(codexHistory.parse(lines, "rollout.jsonl")?.turns).toEqual([
      expect.objectContaining({ prompt: "Rename the config loader", reply: "Renamed loadConfig to readConfig in three files." }),
    ]);
  });

  it("returns nothing for a file with no prompts or no folder", () => {
    expect(claudeHistory.parse(["not json", "{}"], "x.jsonl")).toBeUndefined();
    expect(codexHistory.parse(['{"type":"session_meta","payload":{"id":"a"}}'], "x.jsonl")).toBeUndefined();
  });
});

describe("resume decision", () => {
  it("resumes only on the direct route", () => {
    expect(importContinuation("direct")).toEqual({ continuation: "resume" });
    expect(importContinuation("gateway")).toMatchObject({ continuation: "replay", reason: expect.stringContaining("Gateway") });
    expect(importContinuation("mock").continuation).toBe("replay");
  });
});

describe("importing a session", () => {
  it("lists the folder's sessions, imports one as history that replays, and opens the same thread on a second import", async () => {
    const { engine, projectId, project } = await setup({ mock: true });
    const listing = await engine.listImportableSessions(projectId);
    expect(listing.sources).toEqual([{ agent: "claude", found: true }, { agent: "codex", found: true }]);
    expect(listing.sessions.map((item) => [item.agent, item.nativeSessionId, item.turnCount, item.continuation])).toEqual([
      ["codex", CODEX_ID, 2, "replay"],
      ["claude", CLAUDE_ID, 2, "replay"],
    ]);
    expect(listing.sessions[1]).toMatchObject({ title: "Verbose flag", cwd: project, firstPrompt: "Add a --verbose flag to the CLI" });

    const thread = await engine.importSession({ projectId, agent: "claude", nativeSessionId: CLAUDE_ID });
    expect(thread).toMatchObject({ title: "Verbose flag", harnessId: "claude", workspaceMode: "local", carryOver: { replayTranscript: true } });
    expect(thread.origin).toMatchObject({ kind: "import", agent: "claude", nativeSessionId: CLAUDE_ID, continuation: "replay" });
    expect(thread.directSession).toBeUndefined();
    expect(engine.listMessages(thread.id).map((message) => [message.role, message.content])).toEqual([
      ["user", "Add a --verbose flag to the CLI"],
      ["assistant", "Added --verbose. It sets the log level to debug."],
      ["user", "Now write a test for it"],
      ["assistant", "Wrote cli.test.ts. It passes."],
    ]);
    expect((await engine.importSession({ projectId, agent: "claude", nativeSessionId: CLAUDE_ID })).id).toBe(thread.id);
    expect((await engine.listImportableSessions(projectId)).sessions.find((item) => item.agent === "claude")?.importedAs).toBe(thread.id);
    await expect(engine.importSession({ projectId, agent: "codex", nativeSessionId: "missing" })).rejects.toThrow("no longer in the agent's history");
  });

  it("finds nothing for a project whose folder no agent ran in", async () => {
    const { engine, dir } = await setup({ mock: true });
    const elsewhere = path.join(dir, "elsewhere");
    mkdirSync(elsewhere);
    const other = engine.createProject({ name: "Other", workingDirectory: elsewhere });
    expect((await engine.listImportableSessions(other.id)).sessions).toEqual([]);
  });

  it("resumes an imported Claude Code session by its id on the direct route", async () => {
    const { engine, projectId, dir } = await setup({ mock: false });
    const agent = fileURLToPath(new URL("../../claude/src/fixtures/agent.mjs", import.meta.url));
    const preset = PRESET_HARNESSES.find((item) => item.id === "claude")!;
    const original = preset.nativeCommand;
    preset.nativeCommand = { protocol: "claude", command: process.execPath, args: [agent, "normal"] };
    cleanups.push(() => { preset.nativeCommand = original; });
    const log = path.join(dir, "agent.log");
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    vi.stubEnv("CAPSULE_CLAUDE_TEST_LOG", log);
    vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
    vi.spyOn(harness, "whichBinary").mockReturnValue(process.execPath);

    const thread = await engine.importSession({ projectId, agent: "claude", nativeSessionId: CLAUDE_ID });
    expect(thread.origin).toMatchObject({ continuation: "resume" });
    expect(thread.directSession).toMatchObject({ sessionId: CLAUDE_ID, harnessId: "claude" });
    const { run } = await engine.sendMessage({ sessionId: thread.id, content: "Keep going", agentId: "claude", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(run.id)?.status).toBe("completed"), { timeout: 20_000 });
    const args = readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as { args?: string[] }).find((line) => line.args)?.args ?? [];
    expect(args.join(" ")).toMatch(new RegExp(`--resume[= ]${CLAUDE_ID}`));
    expect(engine.listSessions().find((item) => item.id === thread.id)?.directSession?.sessionId).toBe(CLAUDE_ID);
  });
});
