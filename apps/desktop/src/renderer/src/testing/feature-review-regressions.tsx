import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { DEFAULT_CAPSULE_SETTINGS, type ApprovalRequest, type AutomationCreateInput, type Project, type Session } from "@capsule/shared";
import { ApprovalsView } from "../features/library/LibraryViews";
import { AutomationsSettings } from "../features/automations/AutomationsSettings";
import { ImportSessionsProvider, useImportSessions } from "../features/import/ImportSessions";
import { ShelfNote } from "../features/triage/ShelfNote";
import { ToastProvider } from "../lib/toasts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, detail: string) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Feature review regression timed out: ${detail}\n${document.body.textContent?.slice(0, 2000)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const button = (scope: ParentNode, label: string) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((node) => node.textContent?.trim() === label);
function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

const at = "2026-11-01T00:00:00Z";
const projects = [{ id: "p", name: "Shop", workingDirectory: "/tmp/shop" }, { id: "q", name: "Docs", workingDirectory: "/tmp/docs" }] as Project[];
const sessions = [
  { id: "s1", title: "Fix checkout", projectId: "p", state: "active", createdAt: at, updatedAt: at },
  { id: "s2", title: "Update guide", projectId: "q", state: "active", createdAt: at, updatedAt: at },
] as Session[];
const approval = (id: string, sessionId: string): ApprovalRequest => ({
  id, sessionId, runId: `r-${id}`, agentName: "claude", action: "run a command", target: `npm test ${id}`, reason: "", status: "pending", createdAt: at,
} as ApprovalRequest);

/** Approvals, the shelf note, New automation and the import error: what a person sees and can do in each. */
export async function runFeatureReviewRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const container = host.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const calls: string[] = [];
  const base = {
    api: {
      isDesktop: true,
      on: () => () => undefined,
      resolveApproval: async (id: string, decision: string) => { calls.push(`${decision}:${id}`); },
      triageSession: async (id: string, action: { kind: string }) => { calls.push(`${action.kind}:${id}`); return sessions[0]; },
      automationsCreate: async (input: AutomationCreateInput) => { calls.push(`create:${JSON.stringify(input)}`); return "/settings.json"; },
      configOpenFile: async () => undefined,
      listImportableSessions: async () => { calls.push("list"); if (calls.filter((call) => call === "list").length === 1) throw new Error("Permission denied reading ~/.codex"); return { sessions: [], sources: [] }; },
    },
    approvals: [approval("a1", "s1"), approval("a2", "s2"), approval("a3", "s1")],
    sessions, projects, harnesses: [], projectRuns: [], settings: DEFAULT_CAPSULE_SETTINGS,
    sessionId: undefined, view: "approvals",
    project: projects[0], projectId: "p", git: { isRepo: true },
    config: { automations: [], safeMode: false }, configDiagnostics: undefined,
    setProjectId: (project: string, session?: string) => { calls.push(`open:${project}:${session}`); },
    setView: (view: string) => { calls.push(`view:${view}`); },
    setNotice: (text?: string) => { if (text) calls.push(`notice:${text}`); },
    refresh: async () => undefined,
  };
  try {
    window.testWorkspace = base as never;
    root.render(<ApprovalsView />);
    await frame();
    const groups = Array.from(container.querySelectorAll<HTMLElement>(".approvals-thread"));
    assert(groups.length === 2, `Approvals are not grouped by conversation: ${groups.length}`);
    assert(groups[0]!.textContent?.includes("Fix checkout") && groups[0]!.textContent?.includes("Shop") && groups[0]!.querySelectorAll(".conversation-approval").length === 2, "A group does not name its conversation and project, or lost a request");
    button(groups[1]!, "Deny and reply")!.click();
    await until(() => calls.includes("open:q:s2"), "Deny and reply did not open the asking conversation");
    assert(calls.includes("denied:a2") && calls.includes("view:chat"), `Deny and reply sent ${calls.join(" ")}`);
    button(groups[0]!, "Open conversation")!.click();
    assert(calls.includes("open:p:s1"), "Open conversation does not open the thread in its own project");

    window.testWorkspace = { ...base, api: { ...base.api, isDesktop: false, remoteMode: "read" } } as never;
    root.render(<ApprovalsView key="viewer" />);
    await frame();
    assert(!button(container, "Approve once") && container.textContent?.includes("This device can only read"), "A read-only device is offered Approve");

    window.testWorkspace = { ...base, approvals: [] } as never;
    root.render(<ApprovalsView key="empty" />);
    await frame();
    assert(container.textContent?.includes("Nothing is waiting on you."), "The empty Approvals view says nothing");

    calls.length = 0;
    window.testWorkspace = base as never;
    root.render(<ToastProvider><ShelfNote session={{ ...sessions[0]!, settledAt: at }} /></ToastProvider>);
    await frame();
    assert(container.textContent?.includes("Settled"), "A settled thread does not say so under its last turn");
    button(container, "Return to active")!.click();
    await until(() => calls.includes("unsettle:s1"), "Return to active did not unsettle");
    root.render(<ToastProvider><ShelfNote session={{ ...sessions[0]!, snoozedUntil: "2099-01-01T09:00:00Z" }} /></ToastProvider>);
    await frame();
    assert(container.textContent?.includes("Snoozed until") && button(container, "Wake now"), "A snoozed thread does not say until when, or how to wake it");
    root.render(<ToastProvider><ShelfNote session={sessions[0]!} /></ToastProvider>);
    await frame();
    assert(!container.querySelector(".shelf-note"), "An active thread shows a shelf note");

    calls.length = 0;
    root.render(<AutomationsSettings />);
    await frame();
    assert(container.textContent?.includes("No automations yet."), "Automations has no empty state");
    button(container, "New automation")!.click();
    await frame();
    const form = container.querySelector<HTMLFormElement>(".automation-form")!;
    assert(form && document.activeElement === form.querySelector("input"), "New automation does not open a form with the name focused");
    button(form, "Create")!.click();
    await frame();
    assert(form.textContent?.includes("Give it a name.") && !calls.some((call) => call.startsWith("create")), "An empty form was written");
    setValue(form.querySelector<HTMLInputElement>("input[type=text]")!, "Nightly tests");
    setValue(form.querySelector("textarea")!, "/flaky-tests");
    setValue(form.querySelector<HTMLSelectElement>("select")!, "weekly");
    await frame();
    setValue(form.querySelectorAll<HTMLSelectElement>("select")[1]!, "FR");
    setValue(form.querySelector<HTMLInputElement>("input[type=time]")!, "17:30");
    form.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    await frame();
    assert(form.textContent?.includes("Every Friday at 17:30") && form.textContent?.includes("First run"), `The form does not read the schedule back: ${form.querySelector(".automation-form-preview")?.textContent}`);
    button(form, "Create")!.click();
    await until(() => !container.querySelector(".automation-form"), "Create did not close the form");
    const created = JSON.parse(calls.find((call) => call.startsWith("create:"))!.slice(7)) as AutomationCreateInput;
    assert(created.scope === "local" && created.projectId === "p" && created.draft.schedule === "RRULE:FREQ=WEEKLY;BYDAY=FR;BYHOUR=17;BYMINUTE=30" && created.draft.workspace === "worktree" && created.draft.prompt === "/flaky-tests",
      `New automation wrote ${JSON.stringify(created)}`);

    calls.length = 0;
    function OpenOnMount() { const { openImport } = useImportSessions(); useEffect(() => openImport("p"), [openImport]); return null; }
    root.render(<ImportSessionsProvider><OpenOnMount /></ImportSessionsProvider>);
    await until(() => document.querySelector(".import-dialog")?.textContent?.includes("Could not read agent history: Permission denied"), "An import listing error reads as an empty history");
    button(document.querySelector(".import-dialog")!, "Retry")!.click();
    await until(() => document.querySelector(".import-dialog")?.textContent?.includes("No Claude Code or Codex sessions ran in this folder."), "Retry does not read the history again");
    console.log("Feature review regressions passed");
  } finally {
    root.unmount();
    container.remove();
    window.testWorkspace = previous;
  }
}
