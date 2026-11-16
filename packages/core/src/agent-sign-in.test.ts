import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AgentAuthRequiredError, type DirectAcpHost } from "@capsule/acp";
import type { AgentSignInMethod } from "@capsule/shared";

const installed = vi.hoisted(() => new Map<string, string>());
vi.mock("@capsule/harness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capsule/harness")>();
  return {
    ...actual,
    whichBinary: (binaries: string[]) => binaries.map((binary) => installed.get(binary)).find(Boolean),
    noteAuthRequired: vi.fn(actual.noteAuthRequired),
  };
});

const harness = await import("@capsule/harness");
const { CapsuleEngine } = await import("./engine.js");

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  installed.clear();
  vi.restoreAllMocks();
});

async function fixture(runtimeMode: "direct" | "openclaw") {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-sign-in-"));
  const engine = new CapsuleEngine({ databasePath: path.join(directory, "state.sqlite"), userDataDir: directory, autoConnect: false });
  disposals.push(async () => { await engine.stop(); rmSync(directory, { recursive: true, force: true }); });
  await engine.start();
  const internal = engine as unknown as { usingMock: boolean; direct: DirectAcpHost; settings: { runtimeMode: string } };
  internal.usingMock = false;
  internal.settings.runtimeMode = runtimeMode;
  const agentMethods: AgentSignInMethod[] = [
    { kind: "agent", id: "oauth", name: "Browser" },
    { kind: "terminal", id: "tui", name: "Terminal", argv: ["/opt/bin/gemini", "--acp", "--login"] },
  ];
  const signInOptions = vi.spyOn(internal.direct, "signInOptions").mockResolvedValue({ methods: agentMethods, canSignOut: true });
  return { engine, internal, signInOptions, directory };
}

it("offers a native agent its own login command, resolved on this computer, with no ACP handshake", async () => {
  const { engine, signInOptions } = await fixture("direct");
  installed.set("claude", "/opt/bin/claude");
  expect(await engine.agentSignInOptions("claude")).toEqual({
    harnessId: "claude",
    canSignOut: false,
    methods: [{ kind: "cli", id: "cli-login", name: "Run claude auth login", argv: ["/opt/bin/claude", "auth", "login"] }],
  });
  expect(signInOptions).not.toHaveBeenCalled();
});

it("leaves the login command out when its program is not installed", async () => {
  const { engine } = await fixture("direct");
  expect((await engine.agentSignInOptions("codex")).methods).toEqual([]);
});

it("lists the agent's own methods on the direct route, and only terminal ones through the Gateway", async () => {
  const direct = await fixture("direct");
  installed.set("gemini", "/opt/bin/gemini");
  const options = await direct.engine.agentSignInOptions("gemini");
  expect(options.methods.map((method) => method.id)).toEqual(["oauth", "tui"]);
  expect(options.canSignOut).toBe(true);

  (direct.internal.settings as { runtimeMode: string }).runtimeMode = "openclaw";
  const gateway = await direct.engine.agentSignInOptions("gemini");
  expect(gateway.methods.map((method) => method.id)).toEqual(["tui"]);
  expect(gateway.canSignOut).toBe(false);
  expect(gateway.error).toMatch(/Gateway/);
  await expect(direct.engine.agentAuthenticate("gemini", "oauth")).rejects.toThrow(/Gateway/);
});

it("says the agent is not installed instead of spawning a missing program", async () => {
  const { engine, signInOptions } = await fixture("direct");
  const options = await engine.agentSignInOptions("gemini");
  expect(options.error).toMatch(/not installed/);
  expect(signInOptions).not.toHaveBeenCalled();
});

it("remembers an agent that refused to start until signed in, and forgets it once a session starts", async () => {
  const { engine, internal, directory } = await fixture("direct");
  installed.set("gemini", "/opt/bin/gemini");
  const project = engine.createProject({ name: "Sign in", workingDirectory: directory });
  const spawn = vi.spyOn(internal.direct, "spawnAcpSession").mockRejectedValueOnce(new AgentAuthRequiredError("Gemini CLI"));
  await expect(engine.spawnHarness({ projectId: project.id, harnessId: "gemini" })).rejects.toThrow(/Gemini CLI is not signed in/);
  expect(harness.noteAuthRequired).toHaveBeenLastCalledWith("gemini", true);

  spawn.mockResolvedValueOnce({ sessionKey: "direct:acp:gemini:x", usedSlashCommand: false, command: "gemini --acp" });
  await engine.spawnHarness({ projectId: project.id, harnessId: "gemini" });
  expect(harness.noteAuthRequired).toHaveBeenLastCalledWith("gemini", false);
});
