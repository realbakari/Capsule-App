import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Sidebar } from "../features/shell/Sidebar";
import { Inspector } from "../features/shell/Inspector";
import { UsageView } from "../features/library/UsageView";
import { usePanelResize } from "../lib/panel-resize";

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
  const root = createRoot(host);
  try {
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
  } finally {
    root.unmount(); window.testWorkspace = previous;
    if (savedWidth === null) localStorage.removeItem("capsule.inspectorWidth");
    else localStorage.setItem("capsule.inspectorWidth", savedWidth);
  }
}
