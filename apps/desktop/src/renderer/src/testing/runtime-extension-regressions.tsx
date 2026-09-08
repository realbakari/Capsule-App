import { createRoot } from "react-dom/client";
import type { BackgroundBrowserCommand, BackgroundBrowserView, HarnessLiveStatus, HarnessStatus, SessionRef } from "@capsule/shared";
import { CapabilityDetails } from "../features/harness/CapabilityDetails";
import { AgentConfiguration } from "../features/harness/AgentConfiguration";
import { BackgroundBrowser } from "../features/shell/BackgroundBrowser";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Runtime UI regression timed out: ${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const button = (label: string) => Array.from(document.querySelectorAll("button")).find((item) => item.textContent === label)!;

export async function runRuntimeExtensionRegressions(host: HTMLElement) {
  let root = createRoot(host);
  let changes = 0;
  window.testWorkspace = {
    api: { isDesktop: true, setHarnessConfig: async () => { changes++; throw new Error("Agent refused setting"); } },
    refreshHarnessStatus: async () => { throw new Error("Status disconnected"); },
  };
  root.render(<AgentConfiguration sessionId="thread" options={[{ id: "model-choice", name: "Model", currentValue: "one", choices: [{ name: "One", value: "one" }, { name: "Two", value: "two" }] }]} />);
  await until(() => document.querySelector("select"));
  const select = document.querySelector("select")!;
  select.value = "two"; select.dispatchEvent(new Event("change", { bubbles: true }));
  await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("Agent refused setting") && !select.disabled);
  assert(changes === 1 && select.value === "one", "Rejected setting moved the control or stranded its pending state");
  window.testWorkspace = { ...window.testWorkspace, api: { isDesktop: false, setHarnessConfig: async () => { changes++; } } };
  root.render(<AgentConfiguration sessionId="thread" options={[{ id: "safe", type: "boolean", name: "Safe", booleanValue: false, choices: [] }]} />);
  await until(() => document.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled);
  document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  assert(changes === 1 && document.body.textContent?.includes("viewer is read-only"), "Paired viewer offered live agent configuration");
  root.unmount(); root = createRoot(host);

  const session = { id: "thread", harnessId: "grok", harnessState: "waiting", openclawSessionKey: "direct:acp:grok:fixture" } as SessionRef;
  const status: HarnessLiveStatus = { session, state: "waiting", parsed: { reported: { configOptions: [{ id: "safe", type: "boolean", name: "Safe", booleanValue: false, choices: [] }] } } };
  root.render(<div style={{ position: "absolute", left: 450, top: 450 }}>
    <CapabilityDetails compact harness={{ id: "grok", name: "Fixture", runtimeRoute: "direct" } as HarnessStatus} session={session} status={status} />
  </div>);
  await until(() => document.querySelector(".capability-details--compact"));
  const compact = document.querySelector<HTMLDetailsElement>(".capability-details--compact")!;
  const before = compact.getBoundingClientRect().height;
  compact.querySelector("summary")!.click();
  await until(() => compact.open);
  assert(compact.getBoundingClientRect().height === before, "Opening agent settings expanded the composer toolbar");
  const body = compact.querySelector<HTMLElement>(".capability-details-body")!;
  assert(body.getBoundingClientRect().height <= innerHeight * 0.6 + 2 && body.contains(compact.querySelector(".agent-configuration")), "Agent settings escaped the bounded capabilities popover");
  root.unmount(); root = createRoot(host);

  let page: BackgroundBrowserView = { exists: false };
  let inspected = 0;
  let started!: () => void;
  const commands: string[] = [];
  const api = {
    inspectBackgroundBrowser: async () => { inspected++; return page; },
    controlBackgroundBrowser: async (_owner: string, command: BackgroundBrowserCommand) => {
      commands.push(command.kind);
      if (command.kind === "start") {
        await new Promise<void>((resolve) => { started = resolve; });
        page = { exists: true, url: "https://example.test", agentAllowed: false, remoteShared: false };
      } else if (command.kind === "close") page = { exists: false };
      return page;
    },
  };
  window.testWorkspace = { api, session: { id: "thread" } };
  root.render(<BackgroundBrowser desktop url="https://example.test" available active />);
  await until(() => document.querySelector(".background-browser"));
  assert(inspected === 0, "Collapsed background controls started polling previews");
  (document.querySelector("summary") as HTMLElement).click();
  await until(() => button("Start from address bar") && !button("Start from address bar").disabled);
  button("Start from address bar").click();
  await until(() => started);
  (document.querySelector("summary") as HTMLElement).click();
  await until(() => !document.querySelector("details")?.open);
  started();
  await until(() => button("Close page") && !button("Close page").disabled);
  (document.querySelector("summary") as HTMLElement).click();
  await until(() => document.querySelector("details")?.open);
  button("Close page").click();
  await until(() => button("Start from address bar") && !button("Start from address bar").disabled);
  assert(commands.join(",") === "start,close", "Closing/reopening controls lost the owned background page");
  root.unmount(); root = createRoot(host);

  let sharedReads = 0;
  const privateReads = inspected;
  window.testWorkspace = { session: { id: "thread" }, api: { ...api,
    readSharedBrowser: async () => { sharedReads++; return { exists: true, remoteShared: false }; },
  } };
  root.render(<BackgroundBrowser desktop={false} url="" available={false} active />);
  await until(() => sharedReads && document.body.textContent?.includes("No page is shared"));
  assert(inspected === privateReads && commands.length === 2 && !document.querySelector("button"), "Read-only viewer accessed private browser controls");
  root.unmount();
}
