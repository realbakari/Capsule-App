import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { CustomizationRunRecord, EffectiveExtendedConfig, HookEvent, HookHandler, HookMatcherGroup } from "@capsule/shared";
import { FollowUpLoopGuard, HOOK_FOLLOW_UP_LIMIT, HookRunner, matcherAccepts, permissionVerdict, promptVerdict, type HookPayload } from "./hooks.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture(hooks: Partial<Record<HookEvent, HookMatcherGroup[]>>, options: { disabled?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "capsule-hooks-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const source = { scope: "user" as const, path: "/Users/dev/.capsule/settings.json" };
  const runs: CustomizationRunRecord[] = [];
  const config = {
    hooks: Object.fromEntries(Object.entries(hooks).map(([event, groups]) => [event, groups!.map((value) => ({ value, source }))])),
    disableAllHooks: options.disabled === true,
  } as unknown as EffectiveExtendedConfig;
  const runner = new HookRunner({ extended: () => config, record: (run) => runs.push(run) });
  const script = (name: string, body: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, body);
    return `sh ${JSON.stringify(file)}`;
  };
  const payload = (event: HookEvent, extra: Partial<HookPayload> = {}): HookPayload => ({ event, thread_id: "thread-1", project_dir: dir, cwd: dir, route: "direct", ...extra });
  return { dir, runner, runs, script, payload };
}

const command = (text: string, timeout?: number): HookHandler => ({ type: "command", command: text, ...(timeout ? { timeout } : {}) });

it("blocks a prompt on exit 2 with stderr as the reason, after reading the JSON on stdin", async () => {
  const f = fixture({});
  const hook = f.script("block.sh", `cat > "$CAPSULE_PROJECT_DIR/stdin.json"\necho "it holds a secret" >&2\nexit 2\n`);
  const g = fixture({ PromptSubmit: [{ hooks: [command(hook)] }] });
  const results = await g.runner.run("PromptSubmit", { ...f.payload("PromptSubmit"), prompt: "key=sk-123" }, {});
  expect(promptVerdict(results).block?.reason).toBe("it holds a secret");
  expect(JSON.parse(readFileSync(path.join(f.dir, "stdin.json"), "utf8"))).toMatchObject({ event: "PromptSubmit", prompt: "key=sk-123", route: "direct", thread_id: "thread-1" });
  expect(g.runs[0]).toMatchObject({ kind: "hook", label: "PromptSubmit", exitCode: 2, outcome: "blocked: it holds a secret", stderr: "it holds a secret\n" });
});

it("adds context from JSON on stdout, and a JSON block counts as a block", async () => {
  const f = fixture({});
  const context = f.script("context.sh", `echo '{"additionalContext": "Use pnpm, not npm."}'\n`);
  const block = f.script("json-block.sh", `echo '{"decision": "block", "reason": "Not on Fridays."}'\n`);
  const g = fixture({ PromptSubmit: [{ hooks: [command(context)] }] });
  expect(promptVerdict(await g.runner.run("PromptSubmit", f.payload("PromptSubmit"), {})).context).toEqual(["Use pnpm, not npm."]);
  const h = fixture({ PromptSubmit: [{ hooks: [command(context), command(block)] }] });
  expect(promptVerdict(await h.runner.run("PromptSubmit", f.payload("PromptSubmit"), {})).block?.reason).toBe("Not on Fridays.");
});

it("treats other exits and plain output as non-blocking, and stops a slow hook at its time limit", async () => {
  const f = fixture({});
  const fails = f.script("fails.sh", "echo nope >&2\nexit 1\n");
  const prose = f.script("prose.sh", "echo all good\n");
  const slow = f.script("slow.sh", "sleep 5\n");
  const g = fixture({ PromptSubmit: [{ hooks: [command(fails), command(prose), command(slow, 1)] }] });
  const started = Date.now();
  const results = await g.runner.run("PromptSubmit", f.payload("PromptSubmit"), {});
  expect(Date.now() - started).toBeLessThan(4000);
  expect(promptVerdict(results)).toEqual({ context: [] });
  expect(results.map((result) => result.outcome.kind)).toEqual(["failed", "answered", "failed"]);
  expect(g.runs.map((run) => run.outcome).sort()).toEqual(["exit 1", "ok", "timed out after 1s"]);
});

it("posts the same JSON to an HTTP hook and reads its answer", async () => {
  const bodies: unknown[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      bodies.push(JSON.parse(body));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ permissionDecision: "allow", reason: "Tests are safe." }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  const f = fixture({ PermissionRequest: [{ matcher: "execute", hooks: [{ type: "http", url }] }] });
  const results = await f.runner.run("PermissionRequest", { ...f.payload("PermissionRequest"), permission: { kind: "execute", title: "Run", command: "pnpm test", paths: [] } }, { targets: ["execute", "Run"] });
  expect(permissionVerdict(results)).toMatchObject({ decision: "allow", reason: "Tests are safe." });
  expect(bodies[0]).toMatchObject({ event: "PermissionRequest", permission: { command: "pnpm test" } });
});

it("lets deny beat allow, and treats exit 2 as a deny", async () => {
  const f = fixture({});
  const allow = f.script("allow.sh", `echo '{"permissionDecision": "allow"}'\n`);
  const deny = f.script("deny.sh", "echo 'not this one' >&2\nexit 2\n");
  const g = fixture({ PermissionRequest: [{ hooks: [command(allow), command(deny)] }] });
  expect(permissionVerdict(await g.runner.run("PermissionRequest", f.payload("PermissionRequest"), {}))).toMatchObject({ decision: "deny", reason: "not this one" });
});

it("runs only the groups whose matcher takes the tool, and none when hooks are off", () => {
  const groups = { ToolCall: [{ matcher: "edit|write", hooks: [command("true")] }, { matcher: "^Run ", hooks: [command("true")] }, { hooks: [command("true")] }] };
  const f = fixture(groups);
  expect(f.runner.handlers("ToolCall", undefined, ["edit", "Write a.ts"])).toHaveLength(2);
  expect(f.runner.handlers("ToolCall", undefined, ["execute", "Run tests"])).toHaveLength(2);
  expect(f.runner.handlers("TurnEnd", undefined)).toHaveLength(0);
  expect(fixture(groups, { disabled: true }).runner.handlers("ToolCall", undefined, ["edit"])).toHaveLength(0);
  expect(matcherAccepts("Edit|Write", ["edit"])).toBe(true);
  expect(matcherAccepts("Edit", ["NotebookEdit"])).toBe(false);
  expect(matcherAccepts("(", ["x"])).toBe(false);
});

it("caps hook follow-ups in a row until the person writes", () => {
  const guard = new FollowUpLoopGuard();
  for (let index = 0; index < HOOK_FOLLOW_UP_LIMIT; index++) {
    expect(guard.admit("t", "next")).toBe(true);
    guard.sent("t", "next");
  }
  expect(guard.admit("t", "next")).toBe(false);
  guard.sent("t", "A message from the person");
  expect(guard.admit("t", "next")).toBe(true);
});

it("reads the short decision form, keeps an ask's reason, and can hold a file's allow back to ask", async () => {
  const f = fixture({});
  const allow = f.script("short-allow.sh", `echo '{"decision": "allow"}'\n`);
  const ask = f.script("short-ask.sh", `echo '{"decision": "ask", "reason": "Force pushes need a look."}'\n`);
  const g = fixture({ PermissionRequest: [{ hooks: [command(allow)] }] });
  const allowed = await g.runner.run("PermissionRequest", f.payload("PermissionRequest"), {});
  expect(permissionVerdict(allowed)).toMatchObject({ decision: "allow" });
  expect(permissionVerdict(allowed, () => false)).toMatchObject({ decision: "ask" });
  const h = fixture({ PermissionRequest: [{ hooks: [command(allow), command(ask)] }] });
  expect(permissionVerdict(await h.runner.run("PermissionRequest", f.payload("PermissionRequest"), {})))
    .toMatchObject({ decision: "ask", reason: "Force pushes need a look." });
  const p = fixture({ PromptSubmit: [{ hooks: [command(allow)] }] });
  expect(promptVerdict(await p.runner.run("PromptSubmit", f.payload("PromptSubmit"), {}))).toEqual({ context: [] });
});
