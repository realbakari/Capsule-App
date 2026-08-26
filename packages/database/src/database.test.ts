import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleDatabase } from "./database.js";
import { CapsuleRepositories } from "./repositories.js";

describe("CapsuleDatabase", () => {
  it("migrates and persists a project", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-db-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    repos.insertWorkspace({
      id: "ws_1",
      name: "Local",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repos.insertProject({
      id: "proj_1",
      workspaceId: "ws_1",
      name: "Demo",
      defaultSkillIds: ["coding"],
      defaultMode: "code",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const projects = repos.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Demo");
    expect(projects[0]?.defaultSkillIds).toEqual(["coding"]);
    repos.insertSession({
      id: "sess_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentId: "claude",
      title: "Claude session",
      mode: "code",
      state: "active",
      harnessId: "claude",
      harnessState: "running",
      acpMode: "persistent",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const session = repos.getSession("sess_1");
    expect(session?.harnessId).toBe("claude");
    expect(session?.harnessState).toBe("running");
    repos.insertSession({
      id: "sess_2",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentId: "general",
      title: "Inbox thread",
      mode: "chat",
      state: "active",
      workingDirectory: "/tmp/capsule-tasks/2026-08-26/inbox-thread",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(repos.getSession("sess_2")?.workingDirectory).toBe(
      "/tmp/capsule-tasks/2026-08-26/inbox-thread",
    );
    db.close();
  });
});

/** messages have a FK to sessions, so a page test needs a real parent row. */
function seedSession(repos: CapsuleRepositories, sessionId: string): void {
  const at = "2026-01-01T00:00:00.000Z";
  repos.insertWorkspace({ id: "ws_p", name: "Local", createdAt: at, updatedAt: at });
  repos.insertProject({
    id: "proj_p", workspaceId: "ws_p", name: "Demo", defaultSkillIds: [],
    defaultMode: "chat", createdAt: at, updatedAt: at,
  });
  repos.insertSession({
    id: sessionId, workspaceId: "ws_p", projectId: "proj_p", agentId: "general",
    title: "Thread", mode: "chat", state: "active", createdAt: at, updatedAt: at,
  });
}

describe("message pagination", () => {
  it("pages backwards with a stable cursor and reports whether more remain", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-msgpage-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    seedSession(repos, "s1");

    // Same millisecond for every row: created_at alone cannot order these, so
    // this is exactly the case where an unstable cursor skips or repeats.
    const at = "2026-08-26T00:00:00.000Z";
    for (let i = 0; i < 10; i += 1) {
      repos.insertMessage({
        id: `msg_${String(i).padStart(2, "0")}`,
        sessionId: "s1",
        role: "user",
        content: `m${i}`,
        createdAt: at,
      });
    }

    const newest = repos.listMessagesBefore("s1", 4);
    expect(newest.map((m) => m.id)).toEqual(["msg_06", "msg_07", "msg_08", "msg_09"]);

    const older = repos.listMessagesBefore("s1", 4, {
      createdAt: newest[0]!.createdAt,
      id: newest[0]!.id,
    });
    expect(older.map((m) => m.id)).toEqual(["msg_02", "msg_03", "msg_04", "msg_05"]);

    const oldest = repos.listMessagesBefore("s1", 4, {
      createdAt: older[0]!.createdAt,
      id: older[0]!.id,
    });
    expect(oldest.map((m) => m.id)).toEqual(["msg_00", "msg_01"]);

    // No page repeats or drops a row.
    expect(new Set([...oldest, ...older, ...newest].map((m) => m.id)).size).toBe(10);
    db.close();
  });

  it("round-trips the message kind", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-msgkind-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    seedSession(repos, "s1");
    repos.insertMessage({
      id: "m1", sessionId: "s1", role: "user", content: "how are you",
      kind: "steer", createdAt: "2026-08-26T00:00:00.000Z",
    });
    repos.insertMessage({
      id: "m2", sessionId: "s1", role: "user", content: "plain",
      createdAt: "2026-08-26T00:00:01.000Z",
    });
    const rows = repos.listMessages("s1");
    expect(rows.find((m) => m.id === "m1")?.kind).toBe("steer");
    expect(rows.find((m) => m.id === "m2")?.kind ?? null).toBeNull();
    db.close();
  });
});
