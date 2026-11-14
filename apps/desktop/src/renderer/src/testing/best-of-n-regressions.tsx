import { createRoot } from "react-dom/client";
import type { ApplyResult, GroupComparison, HarnessId, Session } from "@capsule/shared";
import { BestOfNProvider } from "../features/best-of-n/BestOfN";
import { ComparePane } from "../features/best-of-n/ComparePane";

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
const thread = (id: string, harnessId: HarnessId): Session => ({
  id, title: `Fix it · ${harnessId}`, workspaceId: "w", projectId: "p", agentId: harnessId, harnessId, mode: "code", state: "active",
  workspaceMode: "worktree", worktreeBranch: `capsule/${id}`, groupId: "g", createdAt: at, updatedAt: at,
});
const sessions = [thread("a", "claude"), thread("b", "codex"), thread("c", "grok")];
const comparison = (winner?: string): GroupComparison => ({
  group: { id: "g", projectId: "p", kind: "best-of-n", prompt: "Fix the login bug", createdAt: at,
    candidates: sessions.map((session) => ({ sessionId: session.id, harnessId: session.harnessId!, model: "" })), ...(winner ? { winnerSessionId: winner, decidedAt: at } : {}) },
  candidates: [
    { sessionId: "a", title: "a", harnessId: "claude", route: "direct", archived: false, worktree: "present", run: { id: "ra", status: "completed", createdAt: at, completedAt: "2026-11-01T00:02:05Z" },
      diff: { files: [{ path: "src/login.ts", added: 12, removed: 3 }], added: 12, removed: 3 }, verification: "passed", usage: { totalTokens: 12_400 }, reply: "Fixed the session check." },
    { sessionId: "b", title: "b", harnessId: "codex", archived: false, worktree: "present", run: { id: "rb", status: "failed", createdAt: at, error: "Codex is not signed in." }, diff: { files: [], added: 0, removed: 0 } },
    { sessionId: "c", title: "c", harnessId: "grok", archived: false, worktree: "present", run: { id: "rc", status: "running", createdAt: at }, diff: { files: [{ path: "src/login.ts", added: 1, removed: 1 }], added: 1, removed: 1 } },
  ],
});

export async function runBestOfNRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const calls: string[] = [];
  let current = comparison();
  const api = {
    ...(base.api as object),
    isDesktop: true,
    on: () => () => undefined,
    listThreadGroups: async () => [current.group],
    compareThreadGroup: async () => current,
    keepCandidate: async (groupId: string, sessionId: string): Promise<ApplyResult> => { calls.push(`keep:${groupId}:${sessionId}`); current = comparison(sessionId); return { applied: true, files: ["src/login.ts"], conflicts: [] }; },
    rateRun: async (runId: string, value: number) => { calls.push(`rate:${runId}:${value}`); },
    gitScopedDiff: async (_project: string, _scope: string, relative: string, sessionId: string) => ({ patch: `diff --git a/${relative} b/${relative}\n--- a/${relative}\n+++ b/${relative}\n@@ -1 +1 @@\n-old ${sessionId}\n+new ${sessionId}\n` }),
  };
  let confirmed: { title: string } | undefined;
  const workspace = {
    ...base, api, sessions, session: sessions[0], projectId: "p", harnesses: [],
    setConfirm: (value?: { title: string }) => { confirmed = value; },
  };
  window.testWorkspace = workspace as never;
  const root = createRoot(host);
  const card = (harness: string) => host.querySelector<HTMLElement>(`.compare-card[aria-label^="${harness}"]`);
  const button = (scope: ParentNode | null, label: string) => Array.from(scope?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((node) => node.textContent?.includes(label));
  try {
    root.render(<BestOfNProvider><ComparePane /></BestOfNProvider>);
    await until(() => host.querySelectorAll(".compare-card").length === 3);
    assert(host.textContent?.includes("Fix the login bug"), "Compare does not show the prompt");
    assert(card("claude")?.textContent?.includes("Done · 2m 5s"), `A finished candidate does not show its time: ${card("claude")?.textContent}`);
    assert(card("claude")?.textContent?.includes("1 file +12 −3"), "A candidate does not show its diff stats");
    assert(card("claude")?.textContent?.includes("Passed") && card("claude")?.textContent?.includes("12k tokens"), "A candidate does not show its checks and usage");
    assert(card("codex")?.textContent?.includes("Codex is not signed in."), "A failed candidate does not say why");
    assert(card("codex")?.textContent?.includes("Usage") && card("codex")?.textContent?.includes("Not reported"), "Missing usage is not said out loud");
    assert(button(card("grok"), "Keep this one")?.disabled, "A working candidate can be kept");
    assert(button(card("codex"), "Keep this one")?.disabled && card("codex")?.textContent?.includes("This candidate changed no files."), "A candidate with nothing to keep does not say why");

    card("claude")!.querySelector<HTMLButtonElement>("[aria-label=\"Good result\"]")!.click(); await settle();
    button(card("claude"), "Keep this one")!.click();
    await until(() => card("claude")?.textContent?.includes("Kept"));
    assert(calls.join(" ") === "rate:ra:1 keep:g:a", `Compare sent ${calls.join(" ")}`);
    button(host, "Set aside the others")!.click(); await settle();
    assert(confirmed?.title === "Set aside the other 2 candidates?", `Setting aside did not ask first: ${confirmed?.title}`);

    button(host, "Same file")!.click();
    await until(() => host.querySelectorAll(".compare-file-column").length === 3 && host.textContent?.includes("new a"));
    assert(host.querySelector("select")?.textContent?.includes("src/login.ts · changed by 2"), "The file picker does not say how many changed a file");
    assert(host.textContent?.includes("new c"), "Same file does not show every candidate's version");

    window.testWorkspace = { ...workspace, api: { ...api, isDesktop: false, remoteMode: "read" } } as never;
    root.render(<BestOfNProvider key="viewer"><ComparePane /></BestOfNProvider>);
    await until(() => host.querySelectorAll(".compare-card").length === 3);
    assert(!button(host, "Keep this one") && !button(host, "Set aside"), "A paired viewer is offered Compare's writes");

    window.testWorkspace = { ...workspace, session: { ...sessions[0], groupId: undefined } } as never;
    root.render(<BestOfNProvider key="empty"><ComparePane /></BestOfNProvider>);
    await until(() => host.textContent?.includes("This thread is not part of a comparison."));
    console.log("Best-of-N regressions passed");
  } finally {
    root.unmount();
    window.testWorkspace = previous;
  }
}
