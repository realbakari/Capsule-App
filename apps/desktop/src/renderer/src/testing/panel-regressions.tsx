import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../features/shell/Sidebar";
import { Inspector } from "../features/shell/Inspector";
import { Titlebar } from "../features/shell/Titlebar";
import { Palette } from "../features/shell/Palette";
import { UsageView } from "../features/library/UsageView";
import { usePanelResize } from "../lib/panel-resize";
import { SIDEBAR_GROUPING_KEY } from "../lib/sidebar";
import type { ProviderUsageSnapshot } from "@capsule/shared";
import { ProviderQuota } from "../features/library/ProviderQuota";
import { RuntimesView } from "../features/harness/RuntimesView";
import { PRESET_HARNESSES } from "@capsule/shared";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function pointer(target: EventTarget, type: string, x: number, pointerId = 1, button = 0) {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, pointerId, button, isPrimary: true }));
}

function ResizeFixture({ change, enabled = true }: { change: (delta: number) => void; enabled?: boolean }) {
  const { resizing, startResize } = usePanelResize(enabled);
  return <div data-resize-active={resizing} onPointerDown={(event) => startResize(event, change)} />;
}
function SidebarFixture({ base }: { base: Record<string, unknown> }) {
  const [sidebarWidth, setSidebarWidth] = useState(264);
  window.testWorkspace = { ...base, sidebarWidth, setSidebarWidth };
  return <div data-sidebar-width={sidebarWidth}><Sidebar /></div>;
}

export async function runPanelRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const savedWidth = localStorage.getItem("capsule.inspectorWidth");
  const savedGrouping = localStorage.getItem(SIDEBAR_GROUPING_KEY);
  localStorage.removeItem(SIDEBAR_GROUPING_KEY);
  const root = createRoot(host);
  try {
    const terminalToggles: boolean[] = [];
    const terminalViews: string[] = [];
    const terminalBase = { ...base, view: "chat", project: undefined, session: { workingDirectory: "/fixture/worktree" },
      api: { ...base.api as object, isDesktop: true }, terminalOpen: false,
      setTerminalOpen: (open: boolean) => terminalToggles.push(open), setView: (view: string) => terminalViews.push(view),
      palette: true, paletteQuery: "", projects: [], sessions: [], setPalette: () => {}, setPaletteQuery: () => {},
    };
    window.testWorkspace = terminalBase;
    root.render(<Titlebar />); await settle();
    const terminalToggle = () => host.querySelector<HTMLButtonElement>('[aria-label="Toggle terminal (⌘J)"]')!;
    assert(!terminalToggle().disabled && terminalToggle().getAttribute("aria-pressed") === "false", "Thread folder did not enable the header terminal");
    terminalToggle().click();
    assert(terminalToggles.join() === "true", "Header terminal did not open the bottom dock");
    window.testWorkspace = { ...terminalBase, terminalOpen: true };
    root.render(<Titlebar />); await settle();
    assert(terminalToggle().getAttribute("aria-pressed") === "true", "Header terminal lost its active state");
    terminalToggle().click();
    assert(terminalToggles.join() === "true,false", "Header terminal could not hide the dock");
    window.testWorkspace = { ...terminalBase, session: undefined };
    root.render(<Titlebar />); await settle();
    assert(terminalToggle().disabled, "Terminal opened without a folder");
    window.testWorkspace = { ...terminalBase, api: { ...terminalBase.api, isDesktop: false } };
    root.render(<Titlebar />); await settle();
    assert(terminalToggle().disabled, "Read-only viewer offered an interactive shell");
    window.testWorkspace = terminalBase;
    root.render(<Palette />); await settle();
    const terminalAction = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((node) => node.textContent?.includes("Show terminal"));
    assert(terminalAction, "Command palette omitted the terminal");
    terminalAction.click(); await settle();
    assert(terminalToggles.join() === "true,false,true" && terminalViews.includes("chat"), "Palette did not open the terminal in conversation context");
    root.render(null); await settle();
    window.testWorkspace = base;
    const deltas: number[] = [];
    root.render(<ResizeFixture change={(delta) => deltas.push(delta)} />); await settle();
    const rail = () => document.querySelector<HTMLElement>("[data-resize-active]")!;
    pointer(rail(), "pointerdown", 100, 1, 2); pointer(window, "pointerup", 140);
    assert(deltas.length === 0, "Secondary button started a resize");
    pointer(rail(), "pointerdown", 100); pointer(window, "pointermove", 125, 2); pointer(window, "pointerup", 140, 2);
    assert(deltas.length === 0, "Another pointer changed or ended a resize");
    pointer(window, "pointerup", 145); await settle();
    assert(deltas.join() === "45" && rail().dataset.resizeActive === "false", "Release without a move lost the final position");

    for (const ending of ["pointercancel", "lostpointercapture", "blur", "disabled", "unmount"]) {
      root.render(<ResizeFixture change={(delta) => deltas.push(delta)} />); await settle();
      pointer(rail(), "pointerdown", 100); pointer(window, "pointermove", 130); await settle();
      if (ending === "disabled") root.render(<ResizeFixture enabled={false} change={(delta) => deltas.push(delta)} />);
      else if (ending === "unmount") root.render(null);
      else if (ending === "blur") window.dispatchEvent(new Event("blur"));
      else pointer(ending === "lostpointercapture" ? rail() : window, ending, 130);
      await settle();
      const count: number = deltas.length;
      pointer(window, "pointermove", 190); pointer(window, "pointerup", 210); await settle();
      assert(deltas.length === count, `${ending} left resize listeners active`);
      assert(!rail() || rail().dataset.resizeActive === "false", `${ending} left resize styling active`);
    }

    const sidebarBase = { ...base, view: "chat", ready: true, projects: [{ id: "p", name: "Workspace" }],
      sessions: [
        { id: "working", projectId: "p", title: "Working turn", state: "active", updatedAt: "2026-09-01T00:00:00Z" },
        { id: "approval", projectId: "p", title: "Waiting decision", state: "active", updatedAt: "2026-09-01T00:00:00Z" },
      ], projectId: "p", sessionId: "working", sidebarCollapsed: false, approvals: [], harnessSessions: [],
      projectRuns: [
        { id: "w", sessionId: "working", status: "running", createdAt: "2026-09-01T00:00:00Z" },
        { id: "a", sessionId: "approval", status: "approval_required", createdAt: "2026-09-01T00:00:00Z" },
      ], api: { on: () => () => {}, updateStatus: async () => ({ state: "current" }) },
    };
    root.render(<SidebarFixture base={sidebarBase} />); await settle();
    pointer(document.querySelector(".sidebar-rail")!, "pointerdown", 264);
    pointer(window, "pointermove", 280); pointer(window, "pointerup", 300); await settle();
    assert(document.querySelector('[data-sidebar-width="300"]'), "Sidebar lost its release width");
    const project = document.querySelector<HTMLElement>('.project-row')!;
    const toggle = project.querySelector<HTMLButtonElement>(".project-toggle")!;
    if (toggle.getAttribute("aria-expanded") === "true") toggle.click();
    await settle();
    assert(project.querySelector('.thread-status')?.textContent === "Approval", "Collapsed project hid a waiting approval behind working status");

    const navigated: string[] = [];
    const groupedBase = { ...sidebarBase, projects: [...sidebarBase.projects, { id: "other", name: "Second workspace" }],
      sessions: [...sidebarBase.sessions, { id: "other-approval", projectId: "other", title: "Review access", state: "active", pinned: true, updatedAt: "2026-09-02T00:00:00Z" }],
      projectRuns: [...sidebarBase.projectRuns, { id: "other-run", sessionId: "other-approval", status: "approval_required", createdAt: "2026-09-02T00:00:00Z" }],
      setProjectId: (projectId: string, threadId: string) => navigated.push(`${projectId}/${threadId}`), setView: () => {},
    };
    const chooseGrouping = async (label: string) => {
      document.querySelector<HTMLButtonElement>('[aria-label="Group conversations"]')!.click(); await settle();
      Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((option) => option.textContent === label)!.click(); await settle();
      assert(document.activeElement?.getAttribute("aria-label") === "Group conversations", "Grouping selector lost keyboard focus");
    };
    root.render(<SidebarFixture base={groupedBase} />); await settle();
    await chooseGrouping("By status");
    assert(localStorage.getItem(SIDEBAR_GROUPING_KEY) === "status", "Status grouping was not saved");
    assert(document.querySelectorAll('[data-thread-item]').length === 3, "Status grouping duplicated or lost a thread");
    const attention = document.querySelector('section[aria-label="Needs you"]')!;
    assert(attention.textContent?.includes("Review access") && attention.textContent?.includes("Second workspace"), "Status grouping omitted the other project's approval or context");
    const badge = attention.querySelector<HTMLElement>(".thread-status.approval")!;
    assert(parseFloat(getComputedStyle(badge).paddingTop) === 0 && badge.getBoundingClientRect().height < 24, "Sidebar approval inherited the conversation card's padding");
    const otherRow = attention.querySelector<HTMLElement>('[aria-label="Review access"]')!;
    assert(otherRow.draggable === false, "Derived groups allowed pinned drag reorder");
    otherRow.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert(navigated[0] === "other/other-approval", "Status navigation opened the wrong project");
    root.render(<SidebarFixture base={{ ...groupedBase, projectRuns: groupedBase.projectRuns.map((run) => run.id === "other-run" ? { ...run, status: "completed", hasResult: true } : run) }} />); await settle();
    assert(document.querySelector('section[aria-label="Ready for review"]')?.textContent?.includes("Review access"), "Live summaries did not move the thread between groups");
    const search = document.querySelector<HTMLInputElement>('.sidebar input[placeholder]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Second workspace");
    search.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    assert(document.querySelectorAll('[data-thread-item]').length === 1, "Status search did not match project context");
    root.render(null); await settle(); root.render(<SidebarFixture base={groupedBase} />); await settle();
    assert(document.querySelector('section[aria-label="Needs you"]'), "Status preference did not survive remount");
    await chooseGrouping("By project");
    assert(document.querySelectorAll('.project-row').length === 2 && !document.querySelector('.sidebar-status-group'), "Project grouping could not be restored");
    const quickActions: string[] = [];
    root.render(<SidebarFixture base={{ ...groupedBase,
      pinSession: (id: string, pinned: boolean) => quickActions.push(`pin:${id}:${pinned}`),
      archiveSession: (id: string) => quickActions.push(`archive:${id}`),
    }} />); await settle();
    const previewRow = document.querySelector<HTMLElement>('[data-thread-item][aria-label="Review access"]')!;
    previewRow.focus({ preventScroll: true });
    await new Promise((resolve) => setTimeout(resolve, 500)); await settle();
    const preview = document.querySelector<HTMLElement>('[role="tooltip"]');
    assert(preview && preview.textContent?.includes("Review access") && preview.textContent.includes("Second workspace"), "Focused conversation omitted its full preview");
    const previewBox = preview.getBoundingClientRect();
    assert(previewBox.left >= 0 && previewBox.right <= innerWidth && previewBox.bottom <= innerHeight, "Preview escaped the viewport");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await settle();
    assert(!document.querySelector('[role="tooltip"]'), "Escape left the sidebar preview open");
    const navigationCount = navigated.length;
    previewRow.querySelector<HTMLButtonElement>('[aria-label="Unpin conversation"]')!.click();
    previewRow.querySelector<HTMLButtonElement>('[aria-label="Archive conversation"]')!.click();
    assert(quickActions.join() === "pin:other-approval:false,archive:other-approval" && navigated.length === navigationCount, "Quick actions navigated or changed the wrong thread");
    const recent = document.querySelector<HTMLElement>('.sidebar-recent-row')!;
    assert(recent.textContent?.includes("Review access"), "Recents did not start with the latest conversation");
    const selectedRecent = document.querySelector<HTMLElement>('.sidebar-recents [aria-current="page"]');
    assert(selectedRecent?.getAttribute("aria-label") === "Working turn", "Recents lost its selected conversation");
    recent.querySelector<HTMLButtonElement>('[aria-label="Unpin conversation"]')!.click();
    recent.querySelector<HTMLButtonElement>('[aria-label="Archive conversation"]')!.click();
    assert(quickActions.slice(-2).join() === "pin:other-approval:false,archive:other-approval" && navigated.length === navigationCount, "Recent quick actions navigated or targeted another conversation");
    assert(recent.getAttribute("aria-describedby") !== previewRow.getAttribute("aria-describedby"), "Recent and project rows share a tooltip ID");
    recent.click();
    assert(navigated.at(-1) === "other/other-approval", "Recents opened the wrong project or thread");
    recent.focus({ preventScroll: true });
    previewRow.focus({ preventScroll: true });
    await new Promise((resolve) => setTimeout(resolve, 500)); await settle();
    window.dispatchEvent(new Event("scroll")); await settle();
    assert(!document.querySelector('[role="tooltip"]'), "Scrolling left a detached preview");
    recent.querySelector<HTMLButtonElement>('[aria-label="Conversation actions"]')!.click(); await settle();
    const rename = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent?.includes("Rename"));
    assert(rename, "Recent conversation omitted rename");
    rename.click(); await settle();
    const renameInput = document.querySelector<HTMLInputElement>('.sidebar-recents input[aria-label="Conversation title"]');
    assert(renameInput?.value === "Review access" && document.querySelectorAll('input[aria-label="Conversation title"]').length === 1, "Rename opened in another section or duplicated its input");
    renameInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle();
    root.render(null); await settle(); localStorage.setItem(SIDEBAR_GROUPING_KEY, "malformed");
    root.render(<SidebarFixture base={groupedBase} />); await settle();
    assert(document.querySelector('.project-row'), "Invalid saved grouping did not fall back to projects");

    const localHarness = { ...PRESET_HARNESSES.find((item) => item.id === "claude"), runtimeRoute: "direct",
      readiness: "ready", binaryPath: "/fixture/claude-agent-acp", liveSessionIds: [], dedicatedProjectIds: [] };
    const runtimeBase = { ...base, ready: true, connected: false, settings: { runtimeMode: "direct" },
      api: { homeDir: "/fixture", isDesktop: true },
      project: { id: "p", name: "Workspace", workingDirectory: "/fixture" }, projectId: "p",
      harnesses: [localHarness], harnessSessions: [], harnessStatuses: {}, doctors: {}, busy: false,
    };
    window.testWorkspace = runtimeBase;
    root.render(<RuntimesView />); await settle();
    assert(!document.querySelector('.gateway-recovery'), "Local agent setup demanded an optional Gateway connection");
    const start = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === "Start a session");
    assert(start && !start.disabled, "Ready local agent was blocked by a disconnected Gateway");
    window.testWorkspace = { ...runtimeBase, harnesses: [{ ...localHarness, runtimeRoute: "gateway" }] };
    root.render(<RuntimesView />); await settle();
    assert(document.querySelector('.gateway-recovery'), "Gateway agent lost its connection recovery control");

    window.testWorkspace = { ...base, project: undefined, projectId: undefined, session: undefined,
      files: [], steps: [], artifacts: [], harnesses: [], harnessSessions: [], inspectorTab: "launcher", inspectorOpen: true, settings: {},
    };
    localStorage.setItem("capsule.inspectorWidth", "350");
    const inspector = () => document.querySelector<HTMLElement>(".inspector")!;
    const renderInspector = () => root.render(<div className="workspace-body" style={{ width: 1600 }}><Inspector /></div>);
    renderInspector(); await settle();
    assert(inspector().style.width === "350px", "Inspector discarded a valid narrow saved width");
    pointer(document.querySelector(".inspector-rail")!, "pointerdown", 100);
    pointer(window, "pointermove", 90); pointer(window, "pointerup", 70); await settle();
    assert(inspector().style.width === "380px", "Inspector lost its opposite-direction release position");
    root.render(null); await settle(); renderInspector(); await settle();
    assert(inspector().style.width === "380px", "Inspector did not restore the final drag width");

    let unavailable = true;
    window.testWorkspace = { api: { usageSummary: async () => ({ totals: {}, requests: 0, sessions: 0, byDay: [], byProvider: [], byModel: [], unavailableSources: unavailable ? ["codex"] : [] }) } };
    root.render(<UsageView />); await settle();
    assert(document.body.textContent?.includes("Some transcripts could not be read (Codex)"), "Usage omitted its coverage failure");
    assert(!document.body.textContent?.includes("No usage in this window"), "Unavailable usage looked like no activity");
    unavailable = false;
    Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Refresh")!.click(); await settle();
    assert(!document.body.textContent?.includes("Some transcripts could not be read") && document.body.textContent?.includes("No usage in this window"), "Usage coverage did not recover on Refresh");

    root.render(null); await settle();
    let snapshot: ProviderUsageSnapshot = { reports: [], truncated: false };
    let failure = false;
    let reads = 0;
    let deferred: Promise<ProviderUsageSnapshot> | undefined;
    const listeners = new Map<string, (payload: unknown) => void>();
    window.testWorkspace = { ...base, readOnly: true, api: {
      isDesktop: false,
      providerUsage: async () => { reads++; if (failure) throw new Error("Snapshot unavailable"); return deferred ?? snapshot; },
      on: (name: string, handler: (payload: unknown) => void) => { listeners.set(name, handler); return () => listeners.delete(name); },
    } };
    root.render(<ProviderQuota />); await settle(); await settle();
    assert(document.body.textContent?.includes("Not reported yet"), "Absent quota looked like zero usage");
    const observedAtMs = Date.now();
    const source = (sessionId: string, usedPercent: number) => ({ sessionId, title: `Conversation ${sessionId}`, report: {
      providerId: "muse" as const, tier: "Standard", observedAtMs,
      window: { usedPercent, windowDurationMins: 300, resetsAtMs: observedAtMs + 300 * 60_000 },
      weekly: { usedPercent: 125, resetsAtMs: observedAtMs - 60_000 },
    } });
    snapshot = { reports: [source("one", 0), source("two", 80)], truncated: false };
    const invalidate = () => listeners.get("state")?.({ command: "provider-usage" });
    const before = reads;
    for (let index = 0; index < 20; index++) invalidate();
    await settle(); await settle();
    assert(reads === before + 1, "Quota invalidations were not coalesced");
    assert(document.body.textContent?.includes("0% used") && document.body.textContent?.includes("125% used"), "Quota values were clamped or hidden in the read-only viewer");
    assert(document.body.textContent?.includes("Reset time passed"), "Quota reset was presented as a new balance");
    const sourceSelect = document.querySelector<HTMLSelectElement>('.provider-quota-select select')!;
    sourceSelect.value = "two"; sourceSelect.dispatchEvent(new Event("change", { bubbles: true })); await settle();
    assert(document.querySelector('.provider-quota-source')?.textContent === "From Conversation two", "Quota selection combined accounts");
    failure = true; invalidate(); await settle(); await settle();
    assert(document.querySelector('[role="alert"]')?.textContent?.includes("Snapshot unavailable"), "Quota failure was hidden");
    assert(document.body.textContent?.includes("Last reported · may be out of date"), "Failed refresh discarded the last observation or left it looking fresh");
    failure = false;
    Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "Refresh report")!.click();
    await settle(); await settle();
    assert(!document.querySelector('[role="alert"]'), "Quota retry could not recover");

    let resolveRead!: (value: ProviderUsageSnapshot) => void;
    deferred = new Promise((resolve) => { resolveRead = resolve; });
    invalidate(); await settle();
    snapshot = { reports: [], truncated: false };
    invalidate(); // Source closed while an older snapshot was in flight.
    deferred = undefined;
    resolveRead({ reports: [source("closed", 99)], truncated: false });
    await settle(); await settle();
    assert(document.body.textContent?.includes("Not reported yet") && !document.querySelector('.provider-quota-card'), "An in-flight snapshot resurrected a closed quota source");
    root.render(null); await settle();
    assert(listeners.size === 0, "Quota unmount retained event subscriptions");
  } finally {
    root.unmount(); window.testWorkspace = previous;
    if (savedWidth === null) localStorage.removeItem("capsule.inspectorWidth");
    else localStorage.setItem("capsule.inspectorWidth", savedWidth);
    if (savedGrouping === null) localStorage.removeItem(SIDEBAR_GROUPING_KEY);
    else localStorage.setItem(SIDEBAR_GROUPING_KEY, savedGrouping);
  }
}
