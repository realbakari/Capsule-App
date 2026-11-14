import { describe, expect, it } from "vitest";
import type { CreateBoardCardInput, Session, ThreadOrigin } from "@capsule/shared";
import { AgentTasks } from "./agent-tasks.js";

const session = (id: string, projectId: string, extra: Partial<Session> = {}): Session => ({
  id, projectId, workspaceId: "w", agentId: "codex", title: id, mode: "code", status: "idle",
  createdAt: "2026-11-14T00:00:00.000Z", updatedAt: "2026-11-14T00:00:00.000Z", ...extra,
} as Session);

function setup(allowed: string[] = []) {
  const sessions = new Map<string, Session>([
    ["caller", session("caller", "p1")],
    ["sibling", session("sibling", "p1", { pendingStart: { prompt: "x", dependsOn: [], autoStart: false, createdAt: "t" } })],
    ["elsewhere", session("elsewhere", "p2", { pendingStart: { prompt: "y", dependsOn: [], autoStart: false, createdAt: "t" } })],
  ]);
  const created: Array<{ input: CreateBoardCardInput; origin: ThreadOrigin }> = [];
  const started: string[] = [];
  const tasks = new AgentTasks({
    getSession: (id) => sessions.get(id),
    listSessions: () => [...sessions.values()],
    latestRuns: () => new Map(),
    allowsStarts: (projectId) => allowed.includes(projectId),
    createCard: async (input, origin) => {
      created.push({ input, origin });
      const card = session(`card${created.length}`, input.projectId, { title: input.title ?? "", origin, pendingStart: input.start ? undefined : { prompt: input.prompt, dependsOn: input.dependsOn, autoStart: input.autoStart, createdAt: "t" } });
      sessions.set(card.id, card);
      return card;
    },
    startCard: async (id) => { started.push(id); const card = { ...sessions.get(id)!, pendingStart: undefined }; sessions.set(id, card); return card; },
  });
  return { tasks, created, started, sessions };
}

describe("agent task tools", () => {
  it("creates drafts that never start on their own unless the project allows it", async () => {
    const { tasks, created } = setup();
    const result = await tasks.create("caller", { title: "Write docs", prompt: "Document the API", depends_on: ["sibling"] });
    expect(result).toMatchObject({ ok: true, data: { started: false } });
    expect(created[0]).toMatchObject({
      input: { projectId: "p1", title: "Write docs", autoStart: false, dependsOn: ["sibling"] },
      origin: { kind: "task", sessionId: "caller" },
    });
    expect(created[0]!.input.start).toBeUndefined();
  });

  it("starts now, or when its dependencies are done, once the project allows it", async () => {
    const { tasks, created } = setup(["p1"]);
    await tasks.create("caller", { title: "Now", prompt: "Go" });
    await tasks.create("caller", { title: "Later", prompt: "Go", depends_on: ["sibling"] });
    expect(created.map(({ input }) => [input.start ?? false, input.autoStart])).toEqual([[true, true], [false, true]]);
  });

  it("keeps every call inside the caller's project", async () => {
    const { tasks, created } = setup(["p1", "p2"]);
    expect(await tasks.create("caller", { title: "t", prompt: "p", depends_on: ["elsewhere"] })).toMatchObject({ ok: false });
    expect(created).toHaveLength(0);
    expect(await tasks.start("caller", "elsewhere")).toMatchObject({ ok: false, detail: "No task elsewhere in this project." });
    const listed = tasks.list("caller");
    expect(listed.ok && (listed.data as Array<{ id: string }>).map((task) => task.id)).toEqual(["sibling"]);
  });

  it("starts only tasks the caller created, and only when allowed", async () => {
    const denied = setup();
    await denied.tasks.create("caller", { title: "Mine", prompt: "p" });
    expect(await denied.tasks.start("caller", "card1")).toMatchObject({ ok: false, detail: expect.stringContaining("drafts") });
    expect(denied.started).toEqual([]);

    const allowed = setup(["p1"]);
    expect(await allowed.tasks.start("caller", "sibling")).toMatchObject({ ok: false, detail: "You can start only tasks you created." });
    await allowed.tasks.create("caller", { title: "Chained", prompt: "p", depends_on: ["sibling"] });
    expect(await allowed.tasks.start("caller", "card1")).toMatchObject({ ok: true });
    expect(allowed.started).toEqual(["card1"]);
    expect(await allowed.tasks.start("caller", "card1")).toMatchObject({ ok: false, detail: "That task has already started." });
  });

  it("rejects malformed requests with a reason the agent can act on", async () => {
    const { tasks } = setup();
    expect(await tasks.create("caller", { prompt: "p" })).toMatchObject({ ok: false, detail: expect.stringContaining("title") });
    expect(await tasks.create("caller", { title: "t", prompt: "p", workspace: "cloud" })).toMatchObject({ ok: false, detail: expect.stringContaining("workspace") });
    expect(await tasks.create("gone", { title: "t", prompt: "p" })).toMatchObject({ ok: false });
  });

  it("lists the caller's own tasks as created by it", async () => {
    const { tasks } = setup();
    await tasks.create("caller", { title: "Mine", prompt: "p" });
    const listed = tasks.list("caller");
    expect(listed.ok && listed.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "card1", createdByYou: true, state: "draft" }),
      expect.objectContaining({ id: "sibling", createdByYou: false }),
    ]));
  });
});
