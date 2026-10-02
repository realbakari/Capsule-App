import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import type { DirectAcpEvents } from "@capsule/acp";
import { DirectCodexSession } from "./session.js";

const fixture = fileURLToPath(new URL("./fixtures/agent.mjs", import.meta.url));
const sessions: DirectCodexSession[] = [];
function create(scenario = "normal", model?: string) {
  const session = new DirectCodexSession({ command: process.execPath, args: [fixture, scenario], cwd: process.cwd(), model,
    timeoutMs: ["hang", "missing-interrupt"].includes(scenario) ? 200 : 3000, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  sessions.push(session); return session;
}
afterEach(async () => { await Promise.all(sessions.splice(0).map((session) => session.close())); });

it.each(["normal", "early"])("streams consecutive %s turns once, with model selection, tools, plans and usage", async (scenario) => {
  const session = create(scenario);
  const output: string[] = []; const tools: unknown[] = []; const plans: unknown[] = []; const usage: unknown[] = [];
  session.on("text", (event) => output.push(event.text)); session.on("tool", (event) => tools.push(event));
  session.on("plan", (event) => plans.push(event)); session.on("usage", (event) => usage.push(event));
  expect(await session.start()).toBe("native-thread");
  await expect(session.prompt("First")).resolves.toEqual({ stopReason: "end_turn" });
  await session.setConfig("model", "model-two");
  await expect(session.prompt("Next")).resolves.toEqual({ stopReason: "end_turn" });
  expect(output).toEqual(["Hello model-one", "Hello model-two"]);
  expect(tools[1]).toMatchObject({ status: "completed", title: "pwd", details: { output: "/fixture" } });
  expect(plans[0]).toEqual({ entries: [{ id: "0", content: "Inspect", status: "completed" }] });
  expect(usage[0]).toMatchObject({ context: { used: 20, size: 1000 }, turn: { inputTokens: 8, cachedReadTokens: 3 } });
  expect(session.models.currentModelId).toBe("model-two");
});

it("rejects unreported models and carries images", async () => {
  await expect(create("normal", "invented").start()).rejects.toThrow("not reported");
  const session = create("image"); await session.start();
  await expect(session.setConfig("model", "invented")).rejects.toThrow("not reported");
  expect(await session.prompt([{ type: "image", mimeType: "image/png", data: "aW1hZ2U=" }])).toEqual({ stopReason: "end_turn" });
});

it("resumes only the exact saved thread and working folder without replaying history", async () => {
  const session = create(); const output: string[] = []; session.on("text", (event) => output.push(event.text));
  expect(await session.start("native-thread")).toBe("native-thread");
  await session.prompt("Continue"); expect(output).toEqual(["Hello model-one"]);
  await expect(create("wrong-id").start("native-thread")).rejects.toThrow("requested conversation");
  await expect(create("wrong-folder").start()).rejects.toThrow("different working folder");
  await expect(create().start("missing")).rejects.toThrow("Session not found");
});

it.each(["approval", "file-approval"])("surfaces %s and accepts only one action", async (scenario) => {
  const session = create(scenario); await session.start();
  let request: Parameters<DirectAcpEvents["permission"]>[0] | undefined;
  session.on("permission", (event) => { request = event; event.allow(); event.allow(); });
  expect(await session.prompt("Work")).toEqual({ stopReason: "end_turn" });
  expect(request?.details).toMatchObject({ preview: "pwd\nInspect the working folder", canApproveOnce: true });
  await request?.settled;
});

it("declines approvals and fails closed when no UI handles them", async () => {
  const session = create("approval"); await session.start();
  session.on("permission", (event) => event.deny());
  expect(await session.prompt("Work")).toEqual({ stopReason: "cancelled" });
  const unattended = create("approval"); await unattended.start();
  expect(await unattended.prompt("Work")).toEqual({ stopReason: "cancelled" });
});

it("interrupts a turn, refuses overlap, and allows the next turn", async () => {
  const session = create("wait"); await session.start();
  const turn = session.prompt("Work");
  await expect(session.prompt("Too soon")).rejects.toThrow("already running");
  await session.cancel(); expect(await turn).toEqual({ stopReason: "cancelled" });
  const next = session.prompt("Next"); await session.cancel(); expect(await next).toEqual({ stopReason: "cancelled" });
});

it.each([["fail", "Model unavailable"], ["exit", "stopped"], ["unsupported", "unsupported interaction"]])("settles %s rather than leaving the turn spinning", async (scenario, error) => {
  const session = create(scenario); await session.start();
  await expect(session.prompt("Work")).rejects.toThrow(error); expect(session.busy).toBe(false);
});

it.each([["hang", "did not answer"], ["malformed", "invalid"]])("cleans up %s initialization", async (scenario, error) => {
  const session = create(scenario); await expect(session.start()).rejects.toThrow(error); expect(session.running).toBe(false);
});

it.each(["active", "ephemeral"])("refuses a saved %s thread", async (scenario) => {
  await expect(create(scenario).start("native-thread")).rejects.toThrow("not idle and durable");
});

it("waits for interruption completion, not merely its acknowledgement", async () => {
  const session = create("slow-interrupt"); await session.start();
  const turn = session.prompt("Work");
  const stopped = session.cancel();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(session.busy).toBe(true);
  await expect(session.prompt("Overlap")).rejects.toThrow("already running");
  await stopped; await expect(turn).resolves.toEqual({ stopReason: "cancelled" });
});

it("closes a connection whose interrupted turn never finishes", async () => {
  const session = create("missing-interrupt"); await session.start();
  const turn = expect(session.prompt("Work")).rejects.toThrow("closed");
  await expect(session.cancel()).rejects.toThrow("did not confirm");
  await turn; expect(session.running).toBe(false);
});
