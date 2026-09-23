import { createRoot } from "react-dom/client";
import { InlineActivity } from "../features/conversation/InlineActivity";
import { StartupScreen, useAppClosing } from "../features/shell/StartupScreen";
import type { Run } from "@capsule/shared";
import type { ToolObservation } from "../lib/turn-timeline";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function StartupFixture({ error, retry }: { error?: string; retry: () => void }) {
  return <StartupScreen error={error} closing={useAppClosing(error)} retry={retry} />;
}

export async function runActivityRegressions(host: HTMLElement) {
  const root = createRoot(host);
  const previousApi = window.capsule;
  const previousWidth = host.style.width;
  let closingListener: ((payload: unknown) => void) | undefined;
  let disposed = false;
  window.capsule = { ...previousApi, on: (_name, listener) => {
    closingListener = listener;
    return (() => { disposed = true; }) as ReturnType<typeof previousApi.on>;
  } };
  try {
    let retries = 0;
    root.render(<StartupFixture error="Workspace read failed" retry={() => retries++} />);
    await settle();
    host.querySelector<HTMLButtonElement>("button")!.click();
    assert(retries === 1, "Recoverable startup lost Retry");
    closingListener?.({ command: "app-shutting-down" });
    await settle();
    assert(host.textContent?.includes("Closing Capsule") && !host.querySelector("button"), "Quit displayed a retryable workspace failure");
    root.render(<StartupFixture key="missed-event" error="Error invoking remote method 'capsule:listProjects': Error: Capsule is shutting down." retry={() => retries++} />);
    await settle();
    assert(!host.querySelector("button") && host.querySelector('[role="status"]'), "Missed shutdown event produced Retry");

    let opened = "";
    const tool: ToolObservation = { id: "call", timestamp: "2026-01-01", title: "Run checks", command: true, kind: "execute", status: "running",
      details: { input: "pnpm test", output: "<script>example</script>\n" + "long-output ".repeat(120), locations: ["src/example.ts"], truncated: true } };
    const renderTool = (value: ToolObservation) => root.render(<InlineActivity tools={[value]} run={{ id: "run", status: "running" } as Run} onOpenFile={(path) => { opened = path; }} />);
    host.style.width = "320px";
    renderTool(tool); await settle();
    assert(!host.querySelector("pre"), "Collapsed tool group eagerly mounted output");
    host.querySelector<HTMLButtonElement>(".inline-activity-toggle")!.click(); await settle();
    host.querySelector<HTMLButtonElement>(".activity-step-toggle")!.click(); await settle();
    const output = host.querySelector<HTMLElement>('[aria-label="Output preview"]')!;
    assert(output.textContent?.includes("<script>example</script>") && !host.querySelector("script"), "Tool output was interpreted as markup");
    assert(host.scrollWidth <= host.clientWidth + 1, "Expanded activity overflowed the narrow transcript");
    assert(getComputedStyle(output).overscrollBehaviorY === "contain", "Nested tool output can scroll the conversation at its edge");
    host.querySelector<HTMLButtonElement>(".activity-file")!.click();
    assert(opened === "src/example.ts", "Reported file did not open through the workspace handler");
    renderTool({ ...tool, status: "completed", details: { ...tool.details, output: "Finished" } }); await settle();
    assert(host.querySelector('[aria-label="Output preview"]') === output && output.textContent === "Finished", "Tool completion remounted or collapsed the open output");
    host.querySelector<HTMLButtonElement>(".activity-step-toggle")!.click(); await settle();
    assert(!host.querySelector("pre"), "Collapsing a tool retained its output DOM");
    host.querySelector<HTMLButtonElement>(".inline-activity-toggle")!.click(); await settle();
    renderTool({ ...tool, details: undefined }); await settle();
    host.querySelector<HTMLButtonElement>(".inline-activity-toggle")!.click(); await settle();
    host.querySelector<HTMLButtonElement>(".activity-step-toggle")!.click(); await settle();
    assert(host.textContent?.includes("No additional details were reported"), "Missing provider data was presented as an empty successful result");
  } finally {
    root.unmount();
    window.capsule = previousApi;
    host.style.width = previousWidth;
  }
  assert(disposed, "Shutdown subscription survived unmount");
}

export async function renderActivityPreview(previewRoot: ReturnType<typeof createRoot>, host: HTMLElement, closing: boolean) {
  previewRoot.render(null);
  await settle();
  previewRoot.render(closing ? <StartupScreen closing retry={() => {}} /> : <div className="thread" style={{ padding: "2rem", maxWidth: "44rem", margin: "auto" }}>
    <p>Checking the changed files and running the project tests.</p>
    <InlineActivity run={{ id: "preview", status: "completed" } as Run} tools={[
      { id: "read", title: "Read project configuration", timestamp: "2026-01-01", status: "completed", kind: "read", command: false, details: { locations: ["package.json"] } },
      { id: "test", title: "Run project checks", timestamp: "2026-01-01", status: "completed", kind: "execute", command: true, details: { input: "pnpm test", output: "✓ Configuration\n✓ Message rendering\n\n12 tests passed" } },
    ]} />
    <p>The project checks passed. The changed files are ready for review.</p>
  </div>);
  await settle();
  if (!closing) {
    host.querySelector<HTMLButtonElement>(".inline-activity-toggle")?.click(); await settle();
    host.querySelectorAll<HTMLButtonElement>(".activity-step-toggle")[1]?.click(); await settle();
  }
}
