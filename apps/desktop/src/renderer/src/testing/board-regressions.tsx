import { createRoot } from "react-dom/client";
import type { Run, Session } from "@capsule/shared";
import { BoardView } from "../features/board/BoardView";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${check.toString()}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const at = "2026-11-01T00:00:00Z";
const thread = (id: string, title: string, extra: Partial<Session> = {}): Session => ({
  id, title, workspaceId: "w", projectId: "board-project", agentId: "claude", harnessId: "claude", mode: "code", state: "active",
  workspaceMode: "worktree", worktreeBranch: `capsule/${id}`, createdAt: at, updatedAt: at, ...extra,
});
const draft = (dependsOn: string[] = []) => ({ prompt: `Prompt for ${dependsOn.join(",") || "nothing"}\nmore`, dependsOn, autoStart: true, createdAt: at });
const run = (sessionId: string, status: Run["status"], extra: Partial<Run> = {}): Run =>
  ({ id: `run-${sessionId}`, sessionId, projectId: "board-project", agentId: "claude", status, prompt: "", createdAt: at, updatedAt: at, ...extra });

const sessions = [
  thread("a", "Write the parser", { pendingStart: draft() }),
  thread("b", "Wire the parser in", { pendingStart: draft(["a"]) }),
  thread("c", "Refactor storage"),
  thread("d", "Fix the flaky test"),
  thread("f", "Upgrade the toolchain"),
  thread("e", "Ship the release", { pendingStart: draft(["f"]) }),
  thread("g", "Old work", { doneAt: at }),
];
const runs = [run("c", "running"), run("d", "completed", { hasResult: true }), run("f", "failed", { error: "spawn ENOENT" }), run("g", "completed")];

export async function runBoardRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const calls: string[] = [];
  const api = {
    ...(base.api as object),
    isDesktop: true,
    listRunEventPage: async (runId: string) => ({
      events: [{ id: `${runId}-1`, runId, timestamp: at, type: "agent.message", message: `Latest from ${runId}`, data: { streamKind: "message" } }],
      hasMore: false,
    }),
    updateBoardCard: async (id: string, op: { type: string; dependsOn?: string }) => { calls.push(`${id}:${op.type}${op.dependsOn ? `:${op.dependsOn}` : ""}`); return sessions.find((item) => item.id === id); },
    createBoardCard: async () => sessions[0],
  };
  const views: string[] = [];
  const workspace = {
    ...base, api, projects: [{ id: "board-project", name: "Board project", workspaceId: "w", defaultSkillIds: [], defaultMode: "code", createdAt: at, updatedAt: at }],
    projectId: "board-project", sessions, projectRuns: runs, harnesses: [],
    setProjectId: (_project: string, sessionId?: string) => { views.push(`open:${sessionId}`); }, setView: (view: string) => views.push(view),
  };
  window.testWorkspace = workspace as never;
  const root = createRoot(host);
  try {
    root.render(<BoardView />);
    const column = (id: string) => Array.from(host.querySelectorAll<HTMLElement>(`.board-column.column-${id} .board-card`)).map((node) => node.dataset.card);
    await until(() => host.querySelector(".board-columns"));
    assert(JSON.stringify(column("draft")) === '["a"]', `Draft column: ${column("draft")}`);
    assert(JSON.stringify(column("queued")) === '["b"]', `Queued column: ${column("queued")}`);
    assert(JSON.stringify(column("running")) === '["c"]', `Running column: ${column("running")}`);
    assert(JSON.stringify(column("review")) === '["d"]', `A finished card is review, not done: ${column("review")}`);
    assert(JSON.stringify(column("done")) === '["g"]', `Done column: ${column("done")}`);
    assert(column("needs-you").includes("e") && column("needs-you").includes("f"), `Needs you column: ${column("needs-you")}`);
    const blocked = host.querySelector<HTMLElement>('[data-card="e"]')!;
    assert(blocked.textContent?.includes("Blocked by Upgrade the toolchain (failed)"), "A blocked card does not say what blocks it");
    assert(Array.from(blocked.querySelectorAll("button")).some((node) => node.textContent?.includes("Start anyway")), "A blocked card offers no way past it");
    assert(host.querySelector('[data-card="b"]')?.textContent?.includes("After Write the parser"), "A queued card does not say what it waits for");
    assert(host.querySelector('[data-card="a"]')?.textContent?.includes("Prompt for nothing") && !host.querySelector('[data-card="a"]')?.textContent?.includes("more"), "A draft does not preview its prompt's first line");
    await until(() => host.querySelector('[data-card="d"]')?.textContent?.includes("Latest from run-d"));
    assert(host.querySelector('[data-card="c"] .board-badge')?.textContent?.includes("capsule/c"), "A card does not show its branch");

    const button = (card: string, label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>(`[data-card="${card}"] button`)).find((node) => node.textContent?.includes(label));
    button("d", "Mark done")!.click(); await settle();
    button("g", "Reopen")!.click(); await settle();
    button("a", "Start")!.click(); await settle();
    assert(calls.join(" ") === "d:done g:reopen a:start", `Card actions sent ${calls.join(" ")}`);
    assert(!button("c", "Mark done"), "A running card can be marked done");

    calls.length = 0;
    const cardNode = (id: string) => host.querySelector<HTMLElement>(`[data-card="${id}"]`)!;
    cardNode("d").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); await settle();
    assert(host.textContent?.includes("should start after “Fix the flaky test”"), "Linking does not say what happens next");
    cardNode("a").dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true })); await settle();
    assert(calls.join(" ") === "a:link:d", `Cmd-click linked ${calls.join(" ")}`);

    button("b", "Depends on")!.click(); await settle();
    const option = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')).find((node) => node.textContent?.includes("Write the parser"));
    assert(option?.getAttribute("aria-checked") === "true", "The depends-on menu does not show the existing link");
    option!.click(); await settle();
    assert(calls.at(-1) === "b:unlink:a", `Unlinking sent ${calls.at(-1)}`);

    cardNode("a").focus();
    cardNode("a").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await settle();
    assert(document.activeElement === cardNode("b"), "Arrow right did not move to the next column");
    cardNode("b").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await settle();
    assert(views.join(" ") === "open:b chat", `Enter opened ${views.join(" ")}`);

    window.testWorkspace = { ...workspace, api: { ...api, isDesktop: false, remoteMode: "read" } } as never;
    root.render(<BoardView key="viewer" />);
    await until(() => host.textContent?.includes("Read only on this device"));
    assert(!host.querySelector(".board-card-actions") && !Array.from(host.querySelectorAll("button")).some((node) => node.textContent?.includes("New card")), "A read-only viewer is offered board writes");

    window.testWorkspace = { ...workspace, sessions: [] } as never;
    root.render(<BoardView key="empty" />);
    await until(() => host.textContent?.includes("No cards in Board project yet"));
    console.log("Board regressions passed");
  } finally {
    root.unmount();
    window.testWorkspace = previous;
  }
}
