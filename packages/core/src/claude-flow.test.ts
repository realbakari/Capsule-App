import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import * as harness from "@capsule/harness";
import { PRESET_HARNESSES } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

it.each(["normal", "approval"])("carries %s native Claude turns and configured settings through a database reopen", async (scenario) => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-claude-flow-")));
  const fixture = fileURLToPath(new URL("../../claude/src/fixtures/agent.mjs", import.meta.url));
  const preset = PRESET_HARNESSES.find((item) => item.id === "claude")!;
  const original = preset.nativeCommand;
  preset.nativeCommand = { protocol: "claude", command: process.execPath, args: [fixture, scenario] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(directory, "cli-state"));
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(process.execPath);
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  let engine = new CapsuleEngine(options);
  try {
    await engine.start();
    const project = engine.createProject({ name: "Native session fixture", workingDirectory: directory });
    const sessions = engine.listSessions();
    const discovered = await engine.discoverHarness(project.id, "claude");
    expect(discovered.models?.availableModels.map((row) => row.modelId)).toEqual(["one", "two"]);
    expect(engine.listSessions()).toEqual(sessions);
    const { session } = await engine.spawnHarness({ projectId: project.id, harnessId: "claude", model: "one" });
    expect(session.openclawSessionKey).toMatch(/^direct:claude:claude:/);
    await engine.setHarnessConfig(session.id, "effort", "high");
    await engine.setHarnessConfig(session.id, "permissions", "acceptEdits");
    expect(engine.listMessages(session.id)).toHaveLength(0);
    for (let index = 0; index < 2; index++) {
      if (index) { await engine.stop(); engine = new CapsuleEngine(options); await engine.start(); }
      const next = await engine.sendMessage({ sessionId: session.id, content: index ? "Continue" : "First", agentId: "claude", mode: "chat" });
      if (scenario === "approval") {
        await vi.waitFor(() => expect(engine.listApprovals("pending")).toHaveLength(1));
        await engine.resolveApproval(engine.listApprovals("pending")[0]!.id, "approved_once");
      }
      await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
      expect(engine.listSessions().find((item) => item.id === session.id)?.directSession?.sessionId).toBe(session.directSession?.sessionId);
    }
    const answers = engine.listMessages(session.id).filter((message) => message.role === "assistant");
    expect(answers.map((answer) => JSON.parse(answer.content))).toEqual([0, 1].map(() => ({ model: "one", effort: "high", permissions: "acceptEdits" })));
    await engine.setHarnessConfig(session.id, "permissions", "default");
    expect(engine.listSessions().find((item) => item.id === session.id)?.directSession?.configuration?.permissions).toBe("default");
  } finally {
    await engine.stop(); preset.nativeCommand = original;
    vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
  }
});

async function claudeFixture(scenario: string) {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-claude-flow-")));
  const fixture = fileURLToPath(new URL("../../claude/src/fixtures/agent.mjs", import.meta.url));
  const preset = PRESET_HARNESSES.find((item) => item.id === "claude")!;
  const original = preset.nativeCommand;
  preset.nativeCommand = { protocol: "claude", command: process.execPath, args: [fixture, scenario] };
  vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
  vi.stubEnv("CLAUDE_CONFIG_DIR", path.join(directory, "cli-state"));
  vi.spyOn(harness, "probeLoginStateNow").mockReturnValue("unknown");
  vi.spyOn(harness, "whichBinary").mockReturnValue(process.execPath);
  const options = { databasePath: path.join(directory, "state.sqlite"), userDataDir: directory };
  const state = { engine: new CapsuleEngine(options) };
  await state.engine.start();
  const project = state.engine.createProject({ name: "Native session fixture", workingDirectory: directory });
  const { session } = await state.engine.spawnHarness({ projectId: project.id, harnessId: "claude" });
  return {
    directory, session, state,
    reopen: async () => { await state.engine.stop(); state.engine = new CapsuleEngine(options); await state.engine.start(); },
    cleanup: async () => {
      await state.engine.stop(); preset.nativeCommand = original;
      vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true });
    },
  };
}

it("records the turn Claude starts by itself about finished background work, with its approval answerable", async () => {
  const f = await claudeFixture("background");
  try {
    const { engine } = f.state;
    const first = await engine.sendMessage({ sessionId: f.session.id, content: "Build it", agentId: "claude", mode: "chat" });
    await vi.waitFor(() => expect(engine.listRuns(f.session.id)).toHaveLength(2));
    expect(engine.getRun(first.run.id)?.status).toBe("completed");
    const wake = engine.listRuns(f.session.id).find((run) => run.id !== first.run.id)!;
    await vi.waitFor(() => expect(engine.listApprovals("pending").map((item) => item.runId)).toEqual([wake.id]));
    expect(engine.getRun(wake.id)?.status).toBe("approval_required");
    expect(engine.listRunEvents(wake.id).some((event) => event.message.includes("Build finished"))).toBe(true);
    await engine.resolveApproval(engine.listApprovals("pending")[0]!.id, "approved_once");
    await vi.waitFor(() => expect(engine.getRun(wake.id)?.status).toBe("completed"));
    expect(engine.listMessages(f.session.id).find((message) => message.runId === wake.id)?.content).toBe("The build finished; checking its log.");
  } finally { await f.cleanup(); }
});

it("starts a fresh Claude session with the transcript when the saved one cannot be resumed", async () => {
  const f = await claudeFixture("normal");
  try {
    const first = await f.state.engine.sendMessage({ sessionId: f.session.id, content: "Remember the word marmalade", agentId: "claude", mode: "chat" });
    await vi.waitFor(() => expect(f.state.engine.getRun(first.run.id)?.status).toBe("completed"));
    const saved = f.state.engine.listSessions().find((item) => item.id === f.session.id)!.directSession!.sessionId;
    await f.reopen();
    // Claude's own record of the conversation is gone, as after a reinstall or a cleared profile.
    rmSync(path.join(f.directory, "cli-state"), { recursive: true, force: true });
    const { engine } = f.state;
    const next = await engine.sendMessage({ sessionId: f.session.id, content: "Which word?", agentId: "claude", mode: "chat" });
    await vi.waitFor(() => expect(engine.getRun(next.run.id)?.status).toBe("completed"));
    const thread = engine.listSessions().find((item) => item.id === f.session.id)!;
    expect(thread.directSession?.sessionId).not.toBe(saved);
    expect(thread.carryOver?.replayTranscript).toBeUndefined();
    expect(engine.listRunEvents(next.run.id).find((event) => event.data?.resumeFailed)?.message).toMatch(/Started a new agent session; the earlier conversation was passed along/);
    const projects = path.join(f.directory, "cli-state", "projects");
    const [folder] = readdirSync(projects);
    const sent = readFileSync(path.join(projects, folder!, `${thread.directSession!.sessionId}.jsonl`), "utf8");
    expect(sent).toContain("conversation-so-far");
    expect(sent).toContain("marmalade");
  } finally { await f.cleanup(); }
});
