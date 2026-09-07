import { expect, it } from "vitest";
import type { HarnessLiveStatus, Session } from "@capsule/shared";
import { HarnessStatusCache, harnessStatusIdentity } from "./harness-status-cache";

const session = { id: "thread", harnessId: "claude", openclawSessionKey: "session-a", workingDirectory: "/a" } as Session;
const status = { harnessId: "claude", openclawSessionKey: "session-a" } as HarnessLiveStatus;

it("rejects a model catalog when the provider, runtime session or working directory changes", async () => {
  const cache = new HarnessStatusCache();
  for (const change of [{ harnessId: "codex" as const }, { openclawSessionKey: "session-b" }, { workingDirectory: "/b" }]) {
    let resolve!: (value: HarnessLiveStatus) => void;
    let current = session;
    const pending = cache.load(session, undefined, () => new Promise((done) => { resolve = done; }), () => harnessStatusIdentity(current));
    current = { ...session, ...change };
    resolve(status);
    expect(await pending).toBe(false);
    expect(cache.get(current)).toBeUndefined();
  }
});

it("shares reads, rejects late forced refreshes and invalidates a project's cwd", async () => {
  const cache = new HarnessStatusCache();
  let resolve!: (value: HarnessLiveStatus) => void;
  const read = () => new Promise<HarnessLiveStatus>((done) => { resolve = done; });
  const identity = () => harnessStatusIdentity(session);
  const old = cache.load(session, undefined, read, identity);
  expect(cache.load(session, undefined, read, identity)).toBe(old);
  expect(await cache.load(session, undefined, async () => status, identity, true)).toBe(true);
  resolve({ ...status, statusText: "stale" });
  expect(await old).toBe(false);
  expect(cache.get(session)).toBe(status);
  const withoutCwd = { ...session, workingDirectory: undefined };
  expect(harnessStatusIdentity(withoutCwd, { workingDirectory: "/a" } as never))
    .not.toBe(harnessStatusIdentity(withoutCwd, { workingDirectory: "/b" } as never));
});
