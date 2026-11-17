import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type ApprovalRequest, type Run, type Session } from "@capsule/shared";
import { BackgroundActivity } from "../features/triage/BackgroundActivity";
import { Toasts } from "../features/toasts/Toasts";
import { ToastProvider } from "../lib/toasts";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, detail: string) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Notice regression timed out: ${detail}\n${document.querySelector(".toast-stack")?.textContent ?? "no toast stack"}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A run first seen already settled is news only if it settled after the window opened. */
const later = () => new Date(Date.now() + 1000).toISOString();
const toastTexts = (container: HTMLElement) => Array.from(container.querySelectorAll(".toast:not(.is-leaving)")).map((toast) => toast.textContent ?? "");

/** Another thread's news reaches the window as a toast, and only when the policy says so. */
export async function runNoticeRegressions(host: HTMLElement) {
  const container = host.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const previous = window.testWorkspace;
  const sessions = [
    { id: "open", title: "Open thread", projectId: "p", state: "active" },
    { id: "other", title: "Login fix", projectId: "p", state: "active" },
  ] as Session[];
  let opened: string | undefined;
  let stateListener: ((payload: unknown) => void) | undefined;
  const base = {
    api: { on: (channel: string, listener: (payload: unknown) => void) => { if (channel === "state") stateListener = listener; return () => undefined; } },
    approvals: [] as ApprovalRequest[],
    projectRuns: [{ id: "r1", sessionId: "other", status: "running" }, { id: "r2", sessionId: "open", status: "running" }] as Run[],
    sessions,
    sessionId: "open",
    view: "chat",
    settings: DEFAULT_CAPSULE_SETTINGS,
    setProjectId: (_project: string, session?: string) => { opened = session; },
    setView: () => undefined,
  };
  let state = base;
  // Each render commits before the next, as separate workspace updates do.
  const render = async (patch: Partial<typeof base>) => {
    state = { ...state, ...patch };
    window.testWorkspace = state;
    root.render(<ToastProvider><Toasts /><BackgroundActivity /></ToastProvider>);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };
  try {
    assert(document.hasFocus(), "Notice regressions need a focused document");
    await render({});
    await render({ projectRuns: [{ id: "r1", sessionId: "other", status: "completed" }, { id: "r2", sessionId: "open", status: "running" }] as Run[] });
    await until(() => toastTexts(container).some((text) => text.includes("“Login fix” finished")), "finished toast");
    container.querySelector<HTMLButtonElement>(".toast-action")!.click();
    assert(opened === "other", "Open on a toast did not open its thread");

    await render({ projectRuns: [{ id: "r1", sessionId: "other", status: "completed" }, { id: "r2", sessionId: "open", status: "failed", error: "Tests failed" }] as Run[] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Counting toasts on their way out too: one shown and swept away is still a flash about the thread you are reading.
    assert(!Array.from(container.querySelectorAll(".toast")).some((toast) => toast.textContent?.includes("Open thread")), "The thread on screen got a toast about itself");

    await render({ projectRuns: [{ id: "r3", sessionId: "other", status: "failed", completedAt: later(), error: "npm test exited with code 1\nat …" }, { id: "r2", sessionId: "open", status: "failed" }] as Run[] });
    await until(() => toastTexts(container).some((text) => text.includes("“Login fix” failed") && text.includes("npm test exited with code 1")), "failure toast with its reason");

    await render({ approvals: [{ id: "a1", runId: "r4", sessionId: "other", agentId: "x", agentName: "Agent", action: "run", target: "make", reason: "", status: "pending", createdAt: later(), details: { questions: [{ question: "Which branch?" }] } } as unknown as ApprovalRequest] });
    await until(() => toastTexts(container).some((text) => text.includes("“Login fix” has a question") && text.includes("Which branch?")), "question toast");

    stateListener?.({ command: "long-command", sessionId: "other", detail: "make build has run for 30 seconds without approval" });
    await until(() => toastTexts(container).some((text) => text.includes("is running a long command")), "long-command toast");

    // Opening the thread reads its news.
    await render({ sessionId: "other" });
    await until(() => !toastTexts(container).some((text) => text.includes("Login fix")), "toast dismissed on open");

    await render({ sessionId: "open", settings: { ...DEFAULT_CAPSULE_SETTINGS, inAppNotifications: false }, projectRuns: [{ id: "r5", sessionId: "other", status: "completed", completedAt: later() }] as Run[] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(toastTexts(container).length === 0, "A toast showed with in-app notifications off");
    const announced = () => container.querySelector("[data-background-announcer]")?.textContent ?? "";
    assert(announced().includes("“Login fix” finished"), "With in-app notifications off, a screen reader heard nothing about another thread");
    const snoozed = sessions.map((entry) => entry.id === "other" ? { ...entry, title: "Snoozed fix", snoozedUntil: new Date(Date.now() + 3_600_000).toISOString() } : entry);
    await render({ sessions: snoozed, projectRuns: [{ id: "r7", sessionId: "other", status: "completed", completedAt: later() }] as Run[] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(!announced().includes("Snoozed fix"), "A snoozed thread was announced");
    await render({ sessions, projectRuns: [{ id: "r8", sessionId: "open", status: "completed", completedAt: later() }] as Run[] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(!announced().includes("Open thread"), "The background announcer spoke for the thread on screen");

    // "Only in the app" turns every desktop notification off; toasts stay.
    await render({ settings: { ...DEFAULT_CAPSULE_SETTINGS, notifyRunComplete: false, notifyApprovals: false, notifyLongCommands: false }, projectRuns: [{ id: "r6", sessionId: "other", status: "completed", completedAt: later() }] as Run[] });
    await until(() => toastTexts(container).some((text) => text.includes("“Login fix” finished")), "toast with desktop notifications off");
  } finally {
    root.unmount();
    container.remove();
    window.testWorkspace = previous;
  }
}
