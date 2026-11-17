import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { SearchResults } from "@capsule/shared";
import { Sidebar } from "../features/shell/Sidebar";
import { JUMP_HINT_DELAY_MS } from "../features/shell/useJumpHints";
import { SIDEBAR_FOLDED_KEY, SIDEBAR_GROUPING_KEY, SIDEBAR_SHOW_MORE_KEY } from "../lib/sidebar";
import { sidebarOrder } from "../lib/session-cycle";
import { effectiveKeymap, isMac } from "../lib/keybindings";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
const row = (id: string) => document.querySelector<HTMLElement>(`[data-thread-id="${id}"]`);
const KEYS = [SIDEBAR_GROUPING_KEY, SIDEBAR_FOLDED_KEY, SIDEBAR_SHOW_MORE_KEY];

/** ⌃Tab order, activity sorting, kept folds, search as a list, rename by keyboard and ⌘1–9 hints, on the real sidebar. */
export async function runSidebarNavigationRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const saved = KEYS.map((key) => localStorage.getItem(key));
  for (const key of KEYS) localStorage.removeItem(key);
  const root = createRoot(host);
  const calls: string[] = [];
  const notices: string[] = [];
  let rename: (id: string, title: string) => Promise<boolean> = async (id, title) => { calls.push(`rename:${id}:${title}`); return true; };
  const projects = [{ id: "alpha", name: "Alpha" }, { id: "beta", name: "Beta" }];
  const sessions = [
    /* Renamed today, so its record changed last; its latest turn is older than its neighbour's. */
    { id: "renamed", projectId: "alpha", title: "Fix login redirect", state: "active", createdAt: "2026-09-01T00:00:00Z", updatedAt: new Date().toISOString() },
    { id: "asked", projectId: "alpha", title: "Draft release notes", state: "active", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" },
    { id: "other", projectId: "beta", title: "Theme audit", state: "active", createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" },
  ];
  const projectRuns = [
    { id: "r1", sessionId: "renamed", status: "completed", hasResult: true, createdAt: "2026-09-02T00:00:00Z", completedAt: "2026-09-02T00:01:00Z" },
    { id: "r2", sessionId: "asked", status: "completed", hasResult: true, createdAt: "2026-09-05T00:00:00Z", completedAt: "2026-09-05T00:01:00Z" },
    { id: "r3", sessionId: "other", status: "completed", hasResult: true, createdAt: "2026-09-04T00:00:00Z", completedAt: "2026-09-04T00:01:00Z" },
  ];
  let select: (id: string) => void = () => {};
  function Fixture() {
    const [selection, setSelection] = useState({ projectId: "alpha", sessionId: "asked" });
    select = (id) => setSelection({ projectId: sessions.find((item) => item.id === id)!.projectId, sessionId: id });
    window.testWorkspace = {
      ...base, view: "chat", ready: true, projects, sessions, projectRuns, ...selection, sidebarCollapsed: false, sidebarWidth: 264,
      setSidebarWidth: () => {}, approvals: [], harnessSessions: [], keyBindings: effectiveKeymap([]),
      setProjectId: (projectId: string, sessionId?: string) => { calls.push(`open:${sessionId}`); if (sessionId) setSelection({ projectId, sessionId }); },
      setView: () => {}, setNotice: (notice: string) => notices.push(notice),
      renameSession: (id: string, title: string) => rename(id, title),
      findInThread: (_projectId: string, sessionId: string, query: string) => calls.push(`find:${sessionId}:${query}`),
      api: { on: () => () => {}, updateStatus: async () => ({ state: "current" }), isDesktop: true,
        search: async (query: string): Promise<SearchResults> => ({ projects: [], sessions: [], runs: [], messages: query.includes("payload")
          ? [{ id: "hit", sessionId: "other", projectId: "beta", sessionTitle: "Theme audit", role: "assistant", excerpt: "reads the payload shape" }] : [] }) },
    };
    return <Sidebar />;
  }
  try {
    root.render(<Fixture />); await settle();
    assert(sidebarOrder().join() === "asked,renamed,other", `Rows did not follow the latest turn, or the published order drifted: ${sidebarOrder().join()}`);
    assert(row("renamed")?.querySelector(".thread-time")?.textContent !== "now", "A rename made the conversation read as new");
    assert(document.querySelector('[aria-label="Back"]')?.getAttribute("title") === `Back (${isMac() ? "⌘[" : "Ctrl+["})`, "Back's tooltip did not name its current keys");

    const betaToggle = () => Array.from(document.querySelectorAll<HTMLElement>(".project-row")).find((item) => item.getAttribute("aria-label") === "Beta")!.querySelector<HTMLButtonElement>(".project-toggle")!;
    betaToggle().click(); await settle();
    assert(!row("other") && sidebarOrder().join() === "asked,renamed", "⌃Tab's order kept a thread in a folded project");
    root.render(null); await settle(); root.render(<Fixture />); await settle();
    assert(!row("other") && localStorage.getItem(SIDEBAR_FOLDED_KEY)?.includes("beta"), "A folded project opened again after a relaunch");
    select("other"); await settle(); await settle();
    assert(row("other") && betaToggle().getAttribute("aria-expanded") === "true", "Reaching a thread left its project folded");
    select("asked"); await settle();

    const search = document.querySelector<HTMLInputElement>('input[aria-label="Search conversations"]')!;
    type(search, "audit"); await settle();
    press(search, "ArrowDown"); await settle();
    assert(row("other")?.classList.contains("search-highlight"), "↓ did not highlight the first match");
    press(search, "Enter"); await settle();
    assert(calls.at(-1) === "open:other", "Enter did not open the highlighted match");
    press(search, "Escape"); await settle();
    assert(search.value === "" && row("renamed"), "Escape did not clear the search");

    type(search, "payload"); await wait(400); await settle();
    const hit = document.querySelector<HTMLElement>('[data-message-hit="hit"]');
    assert(hit && hit.closest('section[aria-label="Messages"]') && hit.textContent?.includes("payload"), "Message text matches were not listed");
    press(search, "ArrowDown"); await settle();
    assert(hit.classList.contains("search-highlight"), "↓ did not reach a message match after the threads");
    press(search, "Enter"); await settle();
    assert(calls.at(-1) === "find:other:payload", "A message match did not open find on the query");
    type(search, "payloads"); await settle();
    assert(document.querySelector('[data-message-hit="hit"]'), "Message matches blinked out while the next search was on its way");
    press(search, "Escape"); await settle();

    row("renamed")!.focus(); press(row("renamed")!, "F2"); await settle();
    const field = () => document.querySelector<HTMLInputElement>('input[aria-label="Conversation title"]');
    assert(field()?.value === "Fix login redirect", "F2 did not start renaming the focused row");
    type(field()!, "Fix login にほん"); await settle();
    press(field()!, "Enter", { isComposing: true }); await settle();
    assert(field() && !calls.some((call) => call.startsWith("rename:")), "Enter while composing saved the title");
    press(field()!, "Enter"); await settle(); await settle();
    assert(!field() && calls.at(-1) === "rename:renamed:Fix login にほん", "Enter did not save once composition ended");
    assert(document.activeElement === row("renamed"), "A keyboard rename did not give focus back to its row");
    rename = async () => { throw new Error("The database is locked."); };
    press(row("renamed")!, "F2"); await settle();
    press(field()!, "Enter"); await settle(); await settle();
    assert(!field() && notices.at(-1)?.includes("database is locked"), "A failed rename left the field stuck or said nothing");

    const modifier = isMac() ? { key: "Meta", metaKey: true } : { key: "Control", ctrlKey: true };
    window.dispatchEvent(new KeyboardEvent("keydown", modifier));
    await wait(JUMP_HINT_DELAY_MS + 80); await settle();
    const hints = Array.from(document.querySelectorAll(".thread-jump-hint"), (item) => item.textContent);
    assert(hints.join() === (isMac() ? "⌘1,⌘2,⌘3" : "Ctrl+1,Ctrl+2,Ctrl+3"), `Holding the jump key did not number the rows: ${hints.join()}`);
    window.dispatchEvent(new KeyboardEvent("keyup", { key: modifier.key }));
    await settle();
    assert(!document.querySelector(".thread-jump-hint"), "Releasing the jump key left the numbers up");
  } finally {
    root.unmount(); window.testWorkspace = previous;
    KEYS.forEach((key, index) => { const value = saved[index]; if (value === null || value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); });
  }
}
