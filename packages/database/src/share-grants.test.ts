import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleDatabase } from "./database.js";
import { CapsuleRepositories } from "./repositories.js";
import { ShareGrantStore } from "./share-grants.js";

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const db = new CapsuleDatabase(path.join(mkdtempSync(path.join(tmpdir(), "capsule-share-")), "capsule.sqlite"));
  const repos = new CapsuleRepositories(db);
  repos.insertWorkspace({ id: "ws", name: "Local", createdAt: AT, updatedAt: AT });
  repos.insertProject({ id: "p", workspaceId: "ws", name: "Demo", defaultSkillIds: [], defaultMode: "code", createdAt: AT, updatedAt: AT });
  for (const id of ["s1", "s2"]) {
    repos.insertSession({ id, workspaceId: "ws", projectId: "p", agentId: "coding", title: id, mode: "code", state: "active", createdAt: AT, updatedAt: AT });
  }
  return { db, repos, store: new ShareGrantStore(db) };
}

describe("ShareGrantStore", () => {
  it("stores only a hash and resolves the secret to its one thread", () => {
    const { db, store } = setup();
    const { grant, token } = store.create({ sessionId: "s1", label: "For review" });
    const stored = db.sqlite.prepare("SELECT * FROM share_grants").all() as Array<Record<string, unknown>>;
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(store.resolve(token)).toEqual(grant);
    expect(store.resolve(`${token}x`)).toBeUndefined();
    expect(store.resolve("")).toBeUndefined();
  });

  it("stops resolving a revoked or expired link, and lists only working ones", () => {
    const { store } = setup();
    const kept = store.create({ sessionId: "s1", now: "2026-01-01T00:00:01.000Z" });
    const revoked = store.create({ sessionId: "s1", now: "2026-01-01T00:00:02.000Z" });
    const expiring = store.create({ sessionId: "s2", expiresAt: "2026-01-02T00:00:00.000Z" });
    expect(store.revoke(revoked.grant.id)?.revokedAt).toBeDefined();
    expect(store.resolve(revoked.token)).toBeUndefined();
    const later = Date.parse("2026-01-03T00:00:00.000Z");
    expect(store.resolve(expiring.token, Date.parse("2026-01-01T12:00:00.000Z"))?.id).toBe(expiring.grant.id);
    expect(store.resolve(expiring.token, later)).toBeUndefined();
    expect(store.listActive("s1").map((grant) => grant.id)).toEqual([kept.grant.id]);
    expect(store.listActive(undefined, later).map((grant) => grant.id)).toEqual([kept.grant.id]);
  });

  it("forgets a deleted thread's links", () => {
    const { repos, store } = setup();
    const { token } = store.create({ sessionId: "s2" });
    repos.deleteSession("s2");
    expect(store.resolve(token)).toBeUndefined();
  });
});
