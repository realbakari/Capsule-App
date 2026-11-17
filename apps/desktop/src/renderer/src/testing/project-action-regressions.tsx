import { createRoot } from "react-dom/client";
import type { ProjectAction } from "@capsule/shared";
import { PersistentTerminals } from "../features/terminal/TerminalDock";
import { ProjectActionsControl } from "../features/shell/ProjectActionsControl";
import { requestTerminalCommand } from "../lib/terminal-requests";
import { rememberLastAction } from "../lib/project-actions";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, detail: string) {
  const deadline = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Project action regression timed out: ${detail}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const dev: ProjectAction = { id: "dev", name: "dev", command: "pnpm dev" };
const test: ProjectAction = { id: "test", name: "test", command: "pnpm test" };
const run = (action: ProjectAction) => requestTerminalCommand({ kind: "run", command: action.command, tab: { key: `p:${action.id}`, label: action.name } });

/** Actions run in the dock: their own tab, taken back only while its shell sits idle. */
export async function runProjectActionRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const container = host.appendChild(document.createElement("div"));
  const root = createRoot(container);
  try {
    const shells: string[] = [];
    const inputs: Array<[string, string]> = [];
    const idle = new Set<string>();
    window.testWorkspace = { api: {
      on: () => () => {},
      terminalStart: async () => { const id = `shell-${shells.length + 1}`; shells.push(id); return { id, cwd: "/fixture/app", pid: 1 }; },
      terminalInput: async (id: string, data: string) => { inputs.push([id, data]); },
      terminalIdle: async (id: string) => idle.has(id),
      terminalStop: async () => {}, terminalResize: async () => {},
    } };
    const tabs = () => Array.from(container.querySelectorAll<HTMLElement>(".terminal-tab")).map((tab) => tab.textContent ?? "");
    const activeTab = () => container.querySelector(".terminal-tab.active")?.textContent ?? "";
    const sent = (id: string) => inputs.filter(([shell]) => shell === id).map(([, data]) => data);

    run(dev);
    root.render(<PersistentTerminals cwd="/fixture/app" visible onClose={() => {}} />);
    await until(() => sent("shell-1").length === 1 && tabs().length === 1, "the dock did not run the action that opened it");
    assert(tabs().join() === "dev" && sent("shell-1")[0] === "\x15pnpm dev\r", `The opening shell was not the action's tab: ${tabs().join()}`);

    run(dev);
    await until(() => sent("shell-2").length === 1 && tabs().length === 2, "a busy action tab was not left alone");
    assert(tabs().join() === "dev,dev 2" && sent("shell-1").length === 1, `A busy action tab took the run: ${tabs().join()}`);

    idle.add("shell-1").add("shell-2");
    run(test);
    await until(() => sent("shell-3").length === 1 && tabs().length === 3, "another action took an idle tab that was not its own");
    assert(tabs().join() === "dev,dev 2,test", `Another action's run did not open its own tab: ${tabs().join()}`);

    run(dev);
    await until(() => sent("shell-1").length === 2, "an idle action tab was not reused");
    await until(() => activeTab() === "dev", "the reused tab was not brought to the front");
    assert(shells.length === 3 && sent("shell-2").length === 1, "Reusing an idle tab opened another shell or ran twice");

    requestTerminalCommand({ kind: "type", command: "codex login" });
    await until(() => sent("shell-4").length === 1 && tabs().length === 4, "a typed command did not get a fresh shell");
    assert(sent("shell-4")[0] === "codex login" && tabs().at(-1) === "Terminal 1", `A typed command ran, or its tab was misnamed: ${tabs().join()}`);
    root.render(<></>);

    const ran: string[] = [];
    const base = {
      project: { id: "p", name: "App", workingDirectory: "/fixture/app", actions: [dev, test] },
      settings: {}, saveProjectActions: async () => ({ saved: true }), setConfirm: () => {},
      runProjectAction: (action: ProjectAction) => ran.push(action.id),
    };
    window.testWorkspace = base;
    root.render(<ProjectActionsControl />);
    const primary = () => container.querySelector<HTMLButtonElement>(".project-action-split > .session-details-action")!;
    await until(() => primary(), "the split button did not render");
    assert(primary().textContent === "Run dev", `The first action was not the one-click button: ${primary().textContent}`);
    primary().click();
    assert(ran.join() === "dev", "The one-click button did not run its action");
    rememberLastAction("p", "test");
    await until(() => primary().textContent === "Run test", "the last action run did not become the one-click button");
    container.querySelector<HTMLButtonElement>('[aria-label="All project actions"]')!.click();
    await until(() => document.querySelectorAll(".project-actions-menu .project-action-run").length === 2, "the chevron did not list every action");
    document.querySelectorAll<HTMLButtonElement>(".project-actions-menu .project-action-run")[0]!.click();
    assert(ran.join() === "dev,dev", "Choosing an action from the list did not run it");

    window.testWorkspace = { ...base, settings: { sandbox: "strict" } };
    root.render(<ProjectActionsControl key="strict" />);
    await until(() => primary()?.disabled, "strict sandbox left the action runnable");
    assert(primary().title.includes("Strict sandbox"), "A blocked action did not say why");
    console.log("Project action regressions passed");
  } finally {
    root.unmount();
    container.remove();
    window.testWorkspace = previous;
  }
}
