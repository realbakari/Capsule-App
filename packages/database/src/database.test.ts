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
    repos.updateProject({
      ...projects[0]!,
      workingDirectory: "/tmp/app",
      extraFolders: ["/tmp/docs"],
      actions: [{ id: "dev", name: "Dev", command: "pnpm dev", previewUrl: "http://localhost:5173" }],
      iconPath: "/tmp/app/icon.png",
      updatedAt: "2026-01-01T00:00:01.000Z",
    });
    expect(repos.getProject("proj_1")?.workingDirectory).toBe("/tmp/app");
    expect(repos.getProject("proj_1")?.extraFolders).toEqual(["/tmp/docs"]);
    expect(repos.getProject("proj_1")?.actions?.[0]?.command).toBe("pnpm dev");
    expect(repos.getProject("proj_1")?.iconPath).toBe("/tmp/app/icon.png");
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
      pinned: true,
      pinOrder: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const session = repos.getSession("sess_1");
    expect(session?.harnessId).toBe("claude");
    expect(session?.harnessState).toBe("running");
    expect(session?.pinOrder).toBe(0);
    repos.insertSession({
      id: "sess_2",
      workspaceId: "ws_1",
      projectId: "proj_1",
      agentId: "general",
      title: "Inbox thread",
      mode: "chat",
      state: "active",
      workingDirectory: "/tmp/capsule-tasks/2026-08-26/inbox-thread",
      workspaceMode: "worktree",
      worktreeBranch: "capsule/inbox-thread",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(repos.getSession("sess_2")?.workingDirectory).toBe(
      "/tmp/capsule-tasks/2026-08-26/inbox-thread",
    );
    expect(repos.getSession("sess_2")?.workspaceMode).toBe("worktree");
    expect(repos.getSession("sess_2")?.worktreeBranch).toBe("capsule/inbox-thread");
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

describe("attention snapshots", () => {
  it("pages run summaries without pulling saved answer bodies into memory", () => {
    const db = new CapsuleDatabase(":memory:");
    const repos = new CapsuleRepositories(db);
    try {
      seedSession(repos, "s1");
      const at = "2026-01-01T00:00:00.000Z";
      db.sqlite.transaction(() => {
        for (let i = 0; i < 405; i++) repos.insertRun({
          id: String(i).padStart(4, "0"), sessionId: "s1", projectId: "proj_p", agentId: "general",
          prompt: "x".repeat(2000), result: "y".repeat(100_000), status: "completed", createdAt: at, updatedAt: at,
        });
      })();
      const first = repos.listRunPage({ sessionId: "s1", limit: 1000 });
      const second = repos.listRunPage({ sessionId: "s1", before: first.before, limit: 200 });
      const last = repos.listRunPage({ sessionId: "s1", before: second.before, limit: 200 });
      expect([first.runs.length, second.runs.length, last.runs.length]).toEqual([200, 200, 5]);
      expect(new Set([...first.runs, ...second.runs, ...last.runs].map((run) => run.id)).size).toBe(405);
      expect(last.hasMore).toBe(false);
      expect(first.runs[0]).toMatchObject({ hasResult: true, prompt: "x".repeat(512) });
      expect(first.runs[0]).not.toHaveProperty("result");
      expect(repos.listLatestRuns()).toHaveLength(1);
      expect(repos.listLatestRuns()[0]).not.toHaveProperty("result");
      repos.insertMessage({ id: "reply", sessionId: "s1", runId: "0001", role: "assistant", content: "Done", createdAt: at });
      expect(repos.hasRecordedReply("s1", "Done", "0001")).toBe(true);
      expect(repos.hasRecordedReply("s1", "Done", "0002")).toBe(false);
      expect(repos.readReplyText("s1", "0001")).toBe("Done");
      repos.insertMessage({ id: "alphabetically-before-reply", sessionId: "s1", runId: "0001", role: "assistant", content: "Next", createdAt: at });
      expect(repos.readReplyText("s1", "0001")).toBe("Done\nNext");
      expect(repos.readReplyText("s1", "0002")).toBe("");
      repos.insertMessage({ id: "oversized", sessionId: "s1", runId: "0002", role: "assistant", content: "x".repeat(2 * 1024 * 1024), createdAt: at });
      expect(() => repos.readReplyText("s1", "0002")).toThrow("reply limit");
    } finally { db.close(); }
  });
  it("reads only each visible thread's latest run state, with stable same-time ordering", () => {
    const db = new CapsuleDatabase(":memory:");
    const repos = new CapsuleRepositories(db);
    try {
      seedSession(repos, "s1");
      const at = "2026-01-01T00:00:00.000Z";
      db.sqlite.transaction(() => {
        for (let i = 0; i < 500; i++) repos.insertRun({ id: `history-${i}`, sessionId: "s1", projectId: "proj_p", agentId: "general", prompt: "Old prompt", result: "x".repeat(1000), status: "failed", createdAt: at, updatedAt: "2026-02-01T00:00:00.000Z" });
        repos.insertRun({ id: "latest", sessionId: "s1", projectId: "proj_p", agentId: "general", prompt: "Latest prompt", status: "completed", createdAt: at, updatedAt: at });
      })();
      // State reads must not deserialize unrelated historical/verification payloads.
      db.sqlite.prepare("UPDATE runs SET verification = 'not-json'").run();
      const states = repos.listLatestRunStates();
      expect(states).toHaveLength(1);
      expect(states[0]).toMatchObject({ id: "latest", sessionId: "s1", status: "completed" });
      expect(states[0]).not.toHaveProperty("prompt");
      expect(states[0]).not.toHaveProperty("result");
      const plan = db.sqlite.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM runs WHERE session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").all("s1");
      expect(JSON.stringify(plan)).toContain("idx_runs_session_created");
      expect(JSON.stringify(plan)).not.toContain("TEMP B-TREE");
      repos.updateSession({ ...repos.getSession("s1")!, state: "archived" });
      expect(repos.listLatestRunStates()).toEqual([]);
    } finally { db.close(); }
  });
});

describe("message pagination", () => {
  it("pages run events by timestamp and id without materializing oversized legacy payloads", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-eventpage-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    try {
      seedSession(repos, "s1");
      const at = "2026-01-01T00:00:00.000Z";
      repos.insertRun({ id: "r", sessionId: "s1", projectId: "proj_p", agentId: "general", prompt: "Work", status: "completed", createdAt: at, updatedAt: at });
      for (let i = 0; i < 405; i++) repos.insertRunEvent({ id: String(i).padStart(4, "0"), runId: "r", timestamp: at, type: "tool", message: i === 404 ? "x".repeat(100_000) : "Event", data: i === 404 ? { output: "x".repeat(2_000_000) } : undefined });
      const first = repos.listRunEventPage("r", 10_000);
      const second = repos.listRunEventPage("r", 200, first.before);
      const last = repos.listRunEventPage("r", 200, second.before);
      expect([first.events.length, second.events.length, last.events.length]).toEqual([200, 200, 5]);
      expect(last.hasMore).toBe(false);
      expect(new Set([...first.events, ...second.events, ...last.events].map((event) => event.id)).size).toBe(405);
      expect(first.events.at(-1)?.message).toHaveLength(8192);
      expect(first.events.at(-1)?.data).toEqual({ payloadTruncated: true });
    } finally { db.close(); }
  });
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

  it("round-trips the message kind and attachments", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-msgkind-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    seedSession(repos, "s1");
    repos.insertMessage({
      id: "m1", sessionId: "s1", role: "user", content: "how are you",
      kind: "steer",
      attachments: [{ name: "brief.md", path: "/tmp/brief.md", size: 42, mimeType: "text/markdown" }],
      createdAt: "2026-08-26T00:00:00.000Z",
    });
    repos.insertMessage({
      id: "m2", sessionId: "s1", role: "user", content: "plain",
      createdAt: "2026-08-26T00:00:01.000Z",
    });
    const rows = repos.listMessages("s1");
    expect(rows.find((m) => m.id === "m1")?.kind).toBe("steer");
    expect(rows.find((m) => m.id === "m1")?.attachments).toEqual([
      { name: "brief.md", path: "/tmp/brief.md", size: 42, mimeType: "text/markdown" },
    ]);
    expect(rows.find((m) => m.id === "m2")?.kind ?? null).toBeNull();
    db.close();
  });
});

describe("a run's checkpoint", () => {
  it("survives being read back", () => {
    // It used to be set on the object and never written to a column, so
    // "what changed in this turn" and "restore this turn" always found
    // nothing — the capture ran on every turn for an answer no one could read.
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-run-checkpoint-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    const now = new Date().toISOString();
    repos.insertWorkspace({ id: "ws_1", name: "Local", createdAt: now, updatedAt: now });
    repos.insertProject({
      id: "p1",
      workspaceId: "ws_1",
      name: "P",
      defaultSkillIds: [],
      defaultMode: "chat",
      createdAt: now,
      updatedAt: now,
    } as never);
    repos.insertSession({
      id: "s1",
      workspaceId: "ws_1",
      projectId: "p1",
      title: "T",
      mode: "chat",
      agentId: "general",
      state: "active",
      createdAt: now,
      updatedAt: now,
    } as never);
    const run = {
      id: "r1",
      sessionId: "s1",
      projectId: "p1",
      agentId: "general",
      status: "completed",
      prompt: "hi",
      createdAt: now,
      updatedAt: now,
    };
    repos.insertRun(run as never);
    expect(repos.getRun("r1")?.checkpointRef).toBeFalsy();

    repos.updateRun({ ...run, checkpointRef: "refs/capsule/checkpoints/s1/turn/1" } as never);
    expect(repos.getRun("r1")?.checkpointRef).toBe("refs/capsule/checkpoints/s1/turn/1");
  });
});
