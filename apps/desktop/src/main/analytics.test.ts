import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Run, Session } from "@capsule/shared";
import { ProductAnalytics } from "./analytics";

const instances: ProductAnalytics[] = [];
afterEach(() => { instances.forEach((item) => item.stop()); vi.restoreAllMocks(); });
const run: Run = { id: "private-run", projectId: "private-project", sessionId: "private-session", agentId: "private-agent",
  prompt: "private prompt", result: "private code", error: "/private/file.txt", status: "completed",
  createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:05Z", completedAt: "2026-10-02T00:00:05Z" };
const session: Session = { id: "private-session", workspaceId: "w", projectId: "p", agentId: "a", title: "private title",
  mode: "code", state: "active", harnessId: "codex", openclawSessionKey: "direct:acp:private-key",
  createdAt: run.createdAt, updatedAt: run.updatedAt };

function fixture() {
  const identityPath = path.join(mkdtempSync(path.join(tmpdir(), "capsule-analytics-")), "identity");
  const sent: unknown[] = [];
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 200 });
  });
  const client = new ProductAnalytics({ identityPath, version: "1.2.3", platform: "darwin", fetch: transport });
  instances.push(client);
  return { client, identityPath, sent, transport };
}

it("collects nothing before consent, then emits only the documented event fields", async () => {
  const { client, identityPath, sent } = fixture();
  client.observeRun(run, () => session); await client.flush();
  expect({ exists: existsSync(identityPath), sent, enabled: client.status().enabled }).toEqual({ exists: false, sent: [], enabled: false });
  client.setConsent(true);
  client.observeRun(run, () => session);
  client.observeRun(run, () => session);
  client.performance(12.6, 104_857_600);
  await client.flush();
  const payload = sent[0] as { batch: Array<{ event: string; properties: Record<string, unknown> }> };
  expect(payload.batch.map((item) => item.event)).toEqual(["app_started", "installation_active", "run_started", "run_finished", "performance_sample"]);
  expect(payload.batch[3]?.properties).toEqual({ harness: "codex", route: "direct", outcome: "completed", duration_ms: 5000,
    distinct_id: readFileSync(identityPath, "utf8"), $process_person_profile: false, $geoip_disable: true, app_version: "1.2.3", platform: "darwin" });
  expect(JSON.stringify(sent)).not.toContain("private");
  expect(payload.batch[4]?.properties.app_memory_mb).toBe(100);
});

it("withdrawal clears the queue and local identity and a later opt-in rotates identity", async () => {
  const { client, identityPath, sent } = fixture();
  client.setConsent(true);
  const first = readFileSync(identityPath, "utf8");
  client.setConsent(false); await client.flush();
  expect({ pending: client.status().pending, exists: existsSync(identityPath), sent }).toEqual({ pending: 0, exists: false, sent: [] });
  client.setConsent(true); await client.flush();
  expect(client.status().enabled).toBe(true);
  expect(readFileSync(identityPath, "utf8")).not.toBe(first);
});

it("keeps stable consent identity on restart without re-enabling after opt-out", async () => {
  const first = fixture(); first.client.setConsent(true);
  const identity = readFileSync(first.identityPath, "utf8"); first.client.stop();
  const next = new ProductAnalytics({ identityPath: first.identityPath, version: "1", platform: "darwin", fetch: first.transport });
  instances.push(next);
  expect(next.status().enabled).toBe(false);
  next.setConsent(true); await next.flush();
  expect(readFileSync(first.identityPath, "utf8")).toBe(identity);
  expect(next.status().lastSentAt).toEqual(expect.any(String));
});

it("drops failed reports without logging sensitive transport errors or retrying work", async () => {
  const { client, transport } = fixture();
  transport.mockRejectedValue(new Error("private token and path"));
  client.setConsent(true); await client.flush();
  expect(client.status()).toMatchObject({ pending: 0, error: "Analytics delivery failed. This batch was dropped; your work is unaffected." });
  client.observeRun({ ...run, status: "failed" }, () => ({ ...session, openclawSessionKey: "gateway:session" }));
  transport.mockResolvedValue(new Response(null, { status: 200 }));
  await client.flush();
  expect(client.status().lastSentAt).toEqual(expect.any(String));
  expect(client.status().error).toBeUndefined();
});

it("aborts an in-flight delivery on withdrawal without recording a successful send", async () => {
  const { client, transport, identityPath } = fixture();
  let signal: AbortSignal | undefined;
  transport.mockImplementation(async (_url, init) => {
    signal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  client.setConsent(true);
  const delivery = client.flush();
  expect(signal?.aborted).toBe(false);
  client.setConsent(false);
  await delivery;
  expect(signal?.aborted).toBe(true);
  expect(existsSync(identityPath)).toBe(false);
  expect(client.status()).toMatchObject({ enabled: false, pending: 0, lastSentAt: undefined, error: undefined });
});

it("honors the disabled override even when consent is saved", async () => {
  const { identityPath, transport } = fixture();
  const client = new ProductAnalytics({ identityPath, version: "1", platform: "darwin", fetch: transport, disabled: true });
  instances.push(client);
  client.setConsent(true);
  client.observeRun(run, () => session);
  client.performance(20, 1000);
  await client.flush();
  expect(client.status().enabled).toBe(false);
  expect(transport).not.toHaveBeenCalled();
  expect(existsSync(identityPath)).toBe(false);
});
