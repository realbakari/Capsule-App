import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXPECTED_SCHEMA_FINGERPRINT } from "@muse-code/sdk";
import { DirectAcpHost, type DirectAcpEvents } from "@capsule/acp";
import { PRESET_HARNESSES } from "@capsule/shared";
import { DirectMuseSession } from "./session.js";
import { approvalChoices, museInput } from "./protocol.js";

const fixture = fileURLToPath(new URL("./fixtures/agent.mjs", import.meta.url));
const sessions: DirectMuseSession[] = [];
function create(scenario = "normal", timeoutMs = 3000, env: Record<string, string> = {}) {
  const session = new DirectMuseSession({
    command: process.execPath, args: [fixture, scenario], cwd: process.cwd(), timeoutMs,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", MUSE_TEST_SCHEMA: EXPECTED_SCHEMA_FINGERPRINT, ...env },
  });
  sessions.push(session);
  return session;
}
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.close())); });

describe("native Muse sessions", () => {
  const effort = (session: DirectMuseSession) => session.reportedCapabilities.configOptions.find((option) => option.id === "reasoning_effort")?.currentValue;

  it("reports an unknown reasoning default independently of model choices and accepts exact tiers", async () => {
    const session = create("no-models");
    await session.start();
    expect(session.reportedCapabilities.configOptions).toHaveLength(1);
    expect(effort(session)).toBeUndefined();
    for (const tier of ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]) {
      await session.setConfig("reasoning_effort", tier);
      expect(effort(session)).toBe(tier);
    }
    await expect(session.setConfig("reasoning_effort", "auto")).rejects.toThrow("Choose a reasoning effort");
  });

  it("preserves native notifications before identity and acknowledgement, ignoring foreign or invalid reports", async () => {
    const early = create("reasoning-early");
    await early.start();
    expect(effort(early)).toBe("low");
    const session = create("reasoning-notification");
    await session.start();
    await session.setConfig("reasoning_effort", "high");
    expect(effort(session)).toBe("ultra");
    expect(session.busy).toBe(false);
  });

  it.each(["reasoning-reject", "reasoning-mismatch"])("requires an exact accepted acknowledgement (%s)", async (scenario) => {
    const session = create(scenario);
    await session.start();
    await expect(session.setConfig("reasoning_effort", "high")).rejects.toThrow();
    expect(effort(session)).toBeUndefined();
    await expect(session.prompt("Next")).resolves.toEqual({ stopReason: "end_turn" });
  });

  it.each(["reasoning-delayed", "reasoning-history-first"])("does not let recovery replace an accepted write without a notification (%s)", async (scenario) => {
    const session = create(scenario);
    await session.start("fixture-session");
    await session.setConfig("reasoning_effort", "max");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(effort(session)).toBe("max");
    expect(session.running).toBe(true);
  });

  it("discards a timed-out recovery even without a newer write", async () => {
    const session = create("reasoning-delayed-timeout");
    await session.start("fixture-session");
    await new Promise((resolve) => setTimeout(resolve, 3_350));
    expect(effort(session)).toBeUndefined();
    await expect(session.prompt("Still usable")).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("recovers a durable setting from one bounded page after process restart", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "capsule-muse-setting-"));
    const env = { MUSE_TEST_STATE: path.join(directory, "state.json") };
    try {
      const first = create("normal", 3000, env);
      await first.start();
      await first.setConfig("reasoning_effort", "max");
      await first.close();
      const restored = create("normal", 3000, env);
      await restored.start("fixture-session");
      await expect.poll(() => effort(restored)).toBe("max");
      await restored.close();
      const unsupported = create("reasoning-unsupported", 3000, env);
      await unsupported.start("fixture-session");
      await unsupported.prompt("No history support");
      expect(effort(unsupported)).toBeUndefined();
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it.each(["normal", "early"])("streams each message once and settles consecutive %s turns", async (scenario) => {
    const session = create(scenario);
    const text: string[] = [];
    const usage: unknown[] = [];
    let boundaries = 0;
    let tools = 0;
    session.on("text", (value) => text.push(value.text));
    session.on("message-end", () => boundaries++);
    session.on("usage", (value) => usage.push(value));
    session.on("tool", () => tools++);
    expect(await session.start()).toBe("fixture-session");
    expect(session.reportedCapabilities.httpMcp).toBe(false);
    expect(session.models?.availableModels).toHaveLength(2);
    expect(await session.prompt("First")).toEqual({ stopReason: "end_turn" });
    expect(await session.prompt("Second")).toEqual({ stopReason: "end_turn" });
    expect(text.join("")).toBe("Hello worldHello world");
    expect(boundaries).toBe(2);
    expect(tools).toBe(2);
    expect(usage[0]).toMatchObject({ turn: { inputTokens: 7, cachedReadTokens: 2 } });
    expect(session.busy).toBe(false);
  });

  it("carries native images and changes only a model reported by the session", async () => {
    const session = create("image");
    await session.start();
    await expect(session.setConfig("model", "invented")).rejects.toThrow("reported");
    await session.setConfig("model", "model-two");
    expect(session.models?.currentModelId).toBe("model-two");
    await expect(session.prompt([{ type: "text", text: "Describe" }, { type: "image", mimeType: "image/png", data: "aW1hZ2U=" }])).resolves.toEqual({ stopReason: "end_turn" });
  });

  it("resumes only the exact saved session and working folder", async () => {
    expect(await create().start("fixture-session")).toBe("fixture-session");
    expect(await create("default-durable").start("fixture-session")).toBe("fixture-session");
    await expect(create("wrong-id").start("fixture-session")).rejects.toThrow("identity");
    await expect(create("wrong-folder").start("fixture-session")).rejects.toThrow("workspace");
    await expect(create("unfinished").start("fixture-session")).rejects.toThrow("unfinished");
    await expect(create("ephemeral").start("fixture-session")).rejects.toThrow("durable");
    await expect(create("unavailable").start("fixture-session")).rejects.toThrow("activity");
  });

  it("waits for cancellation and admits the next turn", async () => {
    const session = create("wait");
    await session.start();
    const turn = session.prompt("Work");
    await expect.poll(() => (session as unknown as { turn?: { id?: string } }).turn?.id).toBeTruthy();
    await expect(session.prompt("Too soon")).rejects.toThrow("active");
    await session.cancel();
    expect(await turn).toEqual({ stopReason: "cancelled" });
    expect(session.busy).toBe(false);
    const next = session.prompt("Next");
    await expect.poll(() => (session as unknown as { turn?: { id?: string } }).turn?.id).toBeTruthy();
    await session.cancel();
    expect(await next).toEqual({ stopReason: "cancelled" });
  });

  it.each(["approval", "no-once"])("deduplicates approval hints and never upgrades a one-time grant (%s)", async (scenario) => {
    const session = create(scenario);
    const approvals: Parameters<DirectAcpEvents["permission"]>[0][] = [];
    session.on("permission", (value) => { approvals.push(value); });
    await session.start();
    const turn = session.prompt("Edit");
    await expect.poll(() => approvals.length).toBe(1);
    expect(approvals[0]?.canApproveOnce).toBe(scenario === "approval");
    if (scenario === "approval") approvals[0]!.allow();
    else approvals[0]!.deny();
    await expect(turn).resolves.toEqual({ stopReason: "end_turn" });
    approvals[0]!.allow(); // stale button cannot send a second or broader decision
    expect(approvals).toHaveLength(1);
  });

  it.each(["failed", "early-failure", "die", "gap", "unhealthy", "oversized", "question"])("fails explicitly instead of claiming a complete %s turn", async (scenario) => {
    const session = create(scenario);
    await session.start();
    await expect(session.prompt("Work")).rejects.toThrow();
    expect(session.busy).toBe(false);
    expect(session.running).toBe(false);
  });

  it("coalesces simultaneous cancellation requests", async () => {
    const session = create("concurrent-stop");
    await session.start();
    const turn = session.prompt("Work");
    await expect.poll(() => (session as unknown as { turn?: { id?: string } }).turn?.id).toBeTruthy();
    await Promise.all([session.cancel(), session.cancel()]);
    expect(await turn).toEqual({ stopReason: "cancelled" });
    expect(session.running).toBe(true);
  });

  it("refreshes a pending approval but never reopens a decided requirement", async () => {
    const session = create("approval-refresh");
    const approvals: Parameters<DirectAcpEvents["permission"]>[0][] = [];
    session.on("permission", (request) => { approvals.push(request); });
    await session.start();
    const turn = session.prompt("Edit");
    await expect.poll(() => approvals.length).toBe(2);
    await expect(approvals[0]!.settled).resolves.toBeUndefined();
    expect(approvals[1]!.details?.preview).toBe("git status --short");
    approvals[0]!.allow();
    approvals[1]!.allow();
    await expect(turn).resolves.toEqual({ stopReason: "end_turn" });
    expect(approvals).toHaveLength(2);
    expect(session.running).toBe(true);
  });

  it.skipIf(process.platform === "win32")("fails when the leader exits and cleans up its owned tool process", async () => {
    const session = create("orphan");
    let ownedChild = 0;
    session.on("text", ({ text }) => { ownedChild = Number(text); });
    try {
      await session.start();
      await expect(session.prompt("Work")).rejects.toThrow();
      expect(ownedChild).toBeGreaterThan(0);
      await session.close();
      await expect.poll(() => {
        try { process.kill(ownedChild, 0); return true; } catch { return false; }
      }).toBe(false);
    } finally {
      await session.close();
      // Only a PID captured by our owned fixture, never a discovered process.
      if (ownedChild > 0) { try { process.kill(ownedChild, "SIGKILL"); } catch { /* already gone */ } }
    }
  });

  it("bounds a stalled handshake and closes a process during startup", async () => {
    const session = create("timeout", 150);
    await expect(session.start()).rejects.toThrow(/time|connection|closed/);
    expect(session.running).toBe(false);
    const closing = create("timeout");
    const started = closing.start();
    await closing.close();
    await expect(started).rejects.toThrow();
  });

  it("keeps the native session behind the existing host lifecycle and distinct key", async () => {
    const host = new DirectAcpHost(() => create());
    const result = await host.spawnAcpSession({ harnessId: "muse", cwd: process.cwd() });
    expect(result.sessionKey).toMatch(/^direct:msp:muse:/);
    expect(result.directSession?.launchSignature).toBe(JSON.stringify(PRESET_HARNESSES.find((preset) => preset.id === "muse")!.nativeCommand));
    expect((await host.statusAcp(result.sessionKey)).parsed.models?.availableModels).toHaveLength(2);
    await expect(host.send(result.sessionKey, "Hello")).resolves.toEqual({ stopReason: "end_turn" });
    await host.closeAll();
    expect(host.isRunning(result.sessionKey)).toBe(false);
  });

});

it("does not map persistent approvals or resources to unsupported native actions", () => {
  expect(approvalChoices([{ choiceId: "forever", scope: "session", decision: "approvedForSession" }]).allow).toBeUndefined();
  expect(() => museInput([{ type: "resource", resource: { uri: "file:///notes", mimeType: "text/plain", text: "Notes" } }])).toThrow("workspace");
});
