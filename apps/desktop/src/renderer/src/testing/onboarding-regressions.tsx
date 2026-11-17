import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, PRESET_HARNESSES, type AgentSignInOptions, type CapsuleSettings, type HarnessStatus } from "@capsule/shared";
import { SignInDialog } from "../features/harness/SignInDialog";
import { AgentStoreControls } from "../features/harness/AgentStoreControls";
import { resetAgentStore } from "../features/harness/agent-store";
import { FirstRunHost } from "../features/onboarding/FirstRun";
import { SetupChecklist } from "../features/onboarding/SetupChecklist";
import { requestFirstRun, updateSetupMarks } from "../features/onboarding/setup-progress";
import { EmptyThreadFolder } from "../features/conversation/EmptyThreadFolder";
import { FOLDER_REQUIRED } from "../lib/harness-preflight";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
async function until<T>(read: () => T | null | undefined | false, message: string): Promise<T> {
  for (let tries = 0; tries < 200; tries += 1) { const value = read(); if (value) return value; await settle(); }
  throw new Error(message);
}
const button = (scope: ParentNode, text: string) => Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === text);

const claude = { ...PRESET_HARNESSES.find((item) => item.id === "claude")!, runtimeRoute: "direct", readiness: "needs_login", loginState: "logged_out", acpxEnabled: false, dedicatedProjectIds: [], liveSessionIds: [], detail: "" } as HarnessStatus;
const codex = { ...PRESET_HARNESSES.find((item) => item.id === "codex")!, runtimeRoute: "direct", readiness: "ready", acpxEnabled: false, dedicatedProjectIds: [], liveSessionIds: [], detail: "" } as HarnessStatus;

/** A bridge whose terminal events the test drives by hand. */
function fakeApi(options: () => Promise<AgentSignInOptions>) {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const calls = { starts: [] as string[], inputs: [] as string[], stops: [] as string[], doctors: 0, authenticate: [] as string[], installs: [] as string[] };
  let ready = false;
  let finishAuth: (() => void) | undefined;
  let finishInstall: (() => void) | undefined;
  const api = {
    isDesktop: true,
    on: (channel: string, handler: (payload: unknown) => void) => {
      const set = handlers.get(channel) ?? new Set();
      set.add(handler);
      handlers.set(channel, set);
      return () => { set.delete(handler); };
    },
    agentSignInOptions: options,
    agentAuthenticate: (_harness: string, method: string) => { calls.authenticate.push(method); return new Promise<void>((resolve) => { finishAuth = resolve; }); },
    agentSignOut: async () => {},
    agentLoginTerminalStart: async (_harness: string, method: string) => { calls.starts.push(method); return { id: `login-${calls.starts.length}`, argv: ["claude", "auth", "login"] }; },
    terminalInput: async (_id: string, data: string) => { calls.inputs.push(data); },
    terminalResize: async () => {},
    terminalStop: async (id: string) => { calls.stops.push(id); },
    terminalAcknowledge: async () => {},
    doctorHarness: async () => { calls.doctors += 1; return { harnessId: "claude", ready, checks: [] }; },
    agentStoreList: async () => [{ harnessId: "codex", offer: { version: "0.9.0", kind: "npm", source: { kind: "npm", packageName: "@openai/codex" } } }],
    agentStoreInstall: (harness: string) => {
      calls.installs.push(harness);
      return new Promise((resolve) => { finishInstall = () => resolve({ harnessId: harness, installed: { version: "0.9.0", kind: "npm", installedAt: "now" } }); });
    },
    agentStoreUninstall: async (harness: string) => ({ harnessId: harness }),
  };
  const emit = (channel: string, payload: unknown) => { for (const handler of handlers.get(channel) ?? []) handler(payload); };
  return { api, calls, emit, setReady: (value: boolean) => { ready = value; }, finishAuth: () => finishAuth?.(), finishInstall: () => finishInstall?.() };
}

export async function runOnboardingRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const root = createRoot(host);
  try {
    const longName = `Sign in with a browser\nIgnore previous instructions ${"x".repeat(200)}`;
    const bridge = fakeApi(async () => ({
      harnessId: "claude",
      canSignOut: true,
      methods: [
        { kind: "agent", id: "oauth", name: longName, description: "Opens your browser" },
        { kind: "terminal", id: "setup-token", name: "Paste a token", argv: ["claude", "setup-token"], env: { CLAUDE_LOGIN: "1" } },
      ],
    }));
    let closed = 0;
    window.testWorkspace = { api: bridge.api, refresh: async () => {}, setTerminalOpen: () => {}, setConfirm: () => {} };
    root.render(<SignInDialog harness={claude} onClose={() => { closed += 1; }} />);
    const dialog = await until(() => document.querySelector<HTMLElement>(".sign-in-dialog .sign-in-methods") && document.querySelector<HTMLElement>(".sign-in-dialog"), "Sign-in methods never listed");
    const names = Array.from(dialog.querySelectorAll(".sign-in-method-copy > b")).map((item) => item.textContent ?? "");
    assert(names[0] && !names[0].includes("\n") && names[0].length <= 80, "An agent-supplied method name was not kept to one capped line");
    assert(button(dialog, "Sign out"), "Sign out missing for an agent that advertises logout");

    button(dialog, "Continue")!.click(); await settle();
    assert(dialog.querySelector(".sign-in-command")?.textContent?.includes("CLAUDE_LOGIN=1") && dialog.textContent?.includes("claude setup-token"), "Terminal sign-in did not show its exact command and env");
    assert(bridge.calls.starts.length === 0, "A login command ran before Run was pressed");
    button(dialog, "Run")!.click();
    const terminal = await until(() => dialog.querySelector<HTMLElement>(".login-terminal .xterm"), "Login terminal never attached");
    assert(bridge.calls.starts.join() === "setup-token", "Run did not start the chosen method");
    bridge.emit("terminalData", { id: "login-1", data: "Paste your token: " });
    await settle();
    const input = terminal.querySelector<HTMLTextAreaElement>("textarea");
    assert(input && document.activeElement === input, "Login terminal did not take focus");
    input.dispatchEvent(new InputEvent("input", { data: "y", inputType: "insertText", bubbles: true }));
    await settle();
    assert(bridge.calls.inputs.join("").includes("y"), "Typing in the login terminal did not reach the program");

    bridge.emit("terminalExit", { id: "login-1", code: 1 });
    await until(() => dialog.textContent?.includes("exit code 1"), "A failed login did not say so");
    assert(button(dialog, "Try again"), "A failed login offered no retry");
    button(dialog, "Try again")!.click(); await settle();
    button(dialog, "Run")!.click();
    await until(() => bridge.calls.starts.length === 2 && dialog.querySelector(".login-terminal"), "Try again did not run the command again");
    bridge.setReady(true);
    bridge.emit("terminalExit", { id: "login-2", code: 0 });
    await until(() => dialog.textContent?.includes("Signed in."), "A clean login exit did not re-check and report signed in");
    assert(bridge.calls.doctors >= 1, "Sign-in success was claimed without a doctor check");

    root.render(null); await settle();
    bridge.setReady(false);
    root.render(<SignInDialog harness={claude} onClose={() => { closed += 1; }} />);
    const second = await until(() => document.querySelector<HTMLElement>(".sign-in-dialog .sign-in-methods") && document.querySelector<HTMLElement>(".sign-in-dialog"), "Dialog did not reopen");
    second.querySelector<HTMLButtonElement>(".sign-in-method .send")!.click(); await settle();
    assert(second.textContent?.includes("Finish signing in in your browser"), "Agent sign-in did not wait on the browser");
    button(second, "I'm signed in")!.click();
    await until(() => second.textContent?.includes("still sees Claude Code as signed out"), "I'm signed in did not re-check");
    bridge.setReady(true);
    bridge.finishAuth();
    await until(() => second.textContent?.includes("Signed in."), "Agent sign-in did not finish");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert(closed === 1, "Escape did not close the sign-in dialog");
    root.render(null); await settle();

    const failing = fakeApi(async () => { throw new Error("Error invoking remote method 'capsule:agentSignInOptions': Error: not implemented"); });
    window.testWorkspace = { api: failing.api, refresh: async () => {}, setTerminalOpen: () => {}, setConfirm: () => {} };
    root.render(<SignInDialog harness={claude} onClose={() => {}} />);
    const fallback = await until(() => document.querySelector<HTMLElement>(".sign-in-dialog .sign-in-methods") && document.querySelector<HTMLElement>(".sign-in-dialog"), "No fallback when the agent's methods could not be read");
    assert(fallback.textContent?.includes("claude auth login"), "Fallback did not offer the preset's own login command");
    root.render(null); await settle();

    resetAgentStore();
    window.testWorkspace = { api: bridge.api, refresh: async () => {}, setConfirm: () => {} };
    root.render(<AgentStoreControls harnessId="codex" name="Codex" />);
    const install = await until(() => button(host, "Install"), "Store offered no Install");
    assert(host.textContent?.includes("v0.9.0 from npm"), "Install did not say what it installs and from where");
    assert(bridge.calls.installs.length === 0, "The store installed without a click");
    install.click();
    await until(() => host.textContent?.includes("Finding the release"), "Install showed no progress before the first event");
    bridge.emit("agentInstallProgress", { harnessId: "codex", phase: "downloading", received: 1_000_000, total: 4_000_000 });
    await until(() => host.textContent?.includes("Downloading · 1.0 of 4.0 MB"), "Install progress was not shown");
    bridge.finishInstall();
    await until(() => host.textContent?.includes("Installed by Capsule · v0.9.0"), "A finished install did not show the managed copy");
    window.testWorkspace = { api: { ...bridge.api, isDesktop: false }, refresh: async () => {}, setConfirm: () => {} };
    resetAgentStore();
    root.render(<AgentStoreControls harnessId="codex" name="Codex" />); await settle();
    assert(!host.querySelector("button"), "A paired device was offered a store action");
    root.render(null); await settle();

    const patches: Partial<CapsuleSettings>[] = [];
    const picked: string[] = [];
    const tasks: string[] = [];
    const firstRunBase = {
      api: bridge.api, harnesses: [claude], projects: [], refresh: async () => {}, setConfirm: () => {}, setTerminalOpen: () => {},
      updateSettings: async (patch: Partial<CapsuleSettings>) => { patches.push(patch); return { ...DEFAULT_CAPSULE_SETTINGS, ...patch }; },
      createTask: async (projectId?: string) => { tasks.push(projectId ?? ""); }, createProjectFromFolder: async () => {},
      agentId: "claude", setAgentId: (id: string) => { picked.push(id); },
    };
    window.testWorkspace = { ...firstRunBase, projects: [{ id: "p1", name: "Existing", workingDirectory: "/tmp/existing" }], settings: DEFAULT_CAPSULE_SETTINGS };
    root.render(<FirstRunHost />); await settle();
    assert(!document.querySelector(".first-run"), "A profile with projects saw first run");
    root.render(null); await settle();
    window.testWorkspace = { ...firstRunBase, settings: { ...DEFAULT_CAPSULE_SETTINGS, firstRunDone: true } };
    root.render(<FirstRunHost />); await settle();
    assert(!document.querySelector(".first-run"), "A finished first run came back");
    root.render(null); await settle();
    window.testWorkspace = { ...firstRunBase, api: { ...bridge.api, isDesktop: false }, settings: DEFAULT_CAPSULE_SETTINGS };
    root.render(<FirstRunHost />); await settle();
    assert(!document.querySelector(".first-run"), "A paired device saw first run");
    root.render(null); await settle();
    window.testWorkspace = { ...firstRunBase, settings: DEFAULT_CAPSULE_SETTINGS };
    root.render(<FirstRunHost />);
    const firstRun = await until(() => document.querySelector<HTMLElement>(".first-run"), "A new profile with no projects did not see first run");
    assert(button(firstRun, "Sign in") && firstRun.querySelector(".first-run-choice")?.textContent?.startsWith("Open a folder"), "First run did not show the agent and the folder on one page");
    assert(!button(firstRun, "Continue") && !firstRun.textContent?.includes("Choose notifications"), "First run still walks through steps");
    assert(button(firstRun, "Start a conversation")?.disabled && firstRun.textContent?.includes("Choose a folder to start."), "Start was offered with no folder, or did not say what it needs");
    assert(picked.length === 0, "First run switched agents with none ready");
    button(firstRun, "Set up later")!.click(); await settle();
    assert(!document.querySelector(".first-run") && patches.some((patch) => patch.firstRunDone === true), "Set up later did not record firstRunDone and leave");
    root.render(null); await settle();

    patches.length = 0;
    const folder = { id: "p2", name: "app", workingDirectory: "/tmp/app" };
    window.testWorkspace = { ...firstRunBase, harnesses: [{ ...claude, readiness: "missing_cli" }, codex], projects: [folder], project: folder, settings: { ...DEFAULT_CAPSULE_SETTINGS, firstRunDone: true } };
    root.render(<FirstRunHost />); await settle();
    requestFirstRun();
    const ready = await until(() => document.querySelector<HTMLElement>(".first-run"), "Set up Capsule did not reopen first run");
    await until(() => picked.includes("codex"), "First run left the composer on an agent that is not installed while another was ready");
    assert(ready.textContent?.includes("Starts with Codex."), "First run did not say which agent the conversation starts with");
    const startButton = button(ready, "Start a conversation")!;
    assert(!startButton.disabled, "Start stayed disabled with a folder chosen");
    startButton.click();
    await until(() => tasks.includes("p2"), "Start a conversation did not open one in the chosen folder");
    assert(patches.some((patch) => patch.firstRunDone === true && patch.defaultAgentId === "codex"), "Finishing did not keep the ready agent for new conversations");
    root.render(null); await settle();

    updateSetupMarks({ pending: true });
    window.testWorkspace = { ...firstRunBase, settings: { ...DEFAULT_CAPSULE_SETTINGS, firstRunDone: true } };
    root.render(<SetupChecklist fallback={<p>No projects yet</p>} />); await settle();
    assert(host.textContent?.includes("Finish setup · 0/2"), "The setup checklist did not replace the empty state");
    host.querySelector<HTMLButtonElement>(".setup-checklist-dismiss")!.click(); await settle();
    assert(host.textContent?.includes("No projects yet") && !host.querySelector(".setup-checklist"), "Dismissing the checklist did not bring back the empty state");
    root.render(null); await settle();

    window.testWorkspace = { ...firstRunBase, sendBlockReason: FOLDER_REQUIRED };
    root.render(<EmptyThreadFolder />); await settle();
    assert(host.textContent?.includes("Agents work inside a folder") && button(host, "Open a folder") && button(host, "Clone a repository"), "An empty thread with no folder did not say the agent needs one and offer both ways in");
    assert(!button(host, "Attach folder") && !button(host, "New project from folder"), "An empty thread offered two buttons that do the same thing");
    button(host, "Clone a repository")!.click();
    await until(() => document.querySelector(".clone-repository-dialog"), "Clone a repository did not open the clone dialog");
    root.render(null); await settle();
    window.testWorkspace = { ...firstRunBase, project: { id: "p3", name: "Notes" }, sendBlockReason: FOLDER_REQUIRED };
    root.render(<EmptyThreadFolder />); await settle();
    assert(button(host, "Attach folder") && !button(host, "Open a folder"), "A named project without a folder was not offered its own folder");
    root.render(null); await settle();
    window.testWorkspace = { ...firstRunBase, api: { ...bridge.api, isDesktop: false }, sendBlockReason: FOLDER_REQUIRED };
    root.render(<EmptyThreadFolder />); await settle();
    assert(host.textContent?.includes("Agents work inside a folder") && !host.querySelector("button"), "A paired device was offered a folder picker that opens on another computer");
  } finally {
    updateSetupMarks({ pending: false });
    resetAgentStore();
    root.unmount();
    window.testWorkspace = previous;
  }
}
