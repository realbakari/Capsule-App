import { createRoot } from "react-dom/client";
import type { ChatMessage, Run, TurnDiffOptions, UpdateCheck } from "@capsule/shared";
import { MessageAttachments } from "../features/conversation/MessageAttachments";
import { TurnOutcome } from "../features/conversation/TurnOutcome";
import { AboutCard, AboutModal } from "../features/settings/AboutModal";
import { Inspector } from "../features/shell/Inspector";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Screenshot regression timed out: ${check.toString()}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function click(text: string) {
  const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  assert(button, `Missing button: ${text}`); button.click();
}

export async function runScreenshotRegressions(host: HTMLElement) {
  const original = window.testWorkspace;
  let root = createRoot(host);
  try {
    let imageReads = 0;
    const opened: string[] = [];
    const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
    const png = canvas.toDataURL();
    window.testWorkspace = { api: { messageImage: async (id: string, index: number) => {
      assert(id === "screenshot" && index === 0, "Image read lost attachment ownership"); imageReads++; return png;
    } } };
    const message = { id: "screenshot", attachments: [{ path: "/tmp/screenshot.png", name: "Screenshot.png", mimeType: "image/png", size: 74000 }, { path: "/tmp/notes.txt", name: "Notes.txt", size: 10 }] } as ChatMessage;
    root.render(<MessageAttachments message={message} onOpen={(path) => opened.push(path)} />);
    await until(() => host.querySelector(".message-image-preview img"));
    assert(imageReads === 1, "Non-image attachment triggered image decoding");
    host.querySelector<HTMLButtonElement>('[aria-label="Open attachment Screenshot.png"]')!.click();
    assert(opened[0] === "/tmp/screenshot.png", "Image did not retain its open action");
    root.unmount(); root = createRoot(host);
    window.testWorkspace = { api: { messageImage: async () => { throw new Error("Source removed"); } } };
    root.render(<MessageAttachments message={message} onOpen={() => {}} />);
    await until(() => host.textContent?.includes("Image preview unavailable"));
    assert(host.textContent?.includes("Screenshot.png"), "Unavailable preview lost the filename");
    root.unmount(); root = createRoot(host);

    const reads: Array<TurnDiffOptions | undefined> = [];
    const patch = "diff --git a/last.ts b/last.ts\n--- a/last.ts\n+++ b/last.ts\n@@ -0,0 +1 @@\n+const answer = 42;\n";
    const run = { id: "saved-run", sessionId: "saved-thread", checkpointRef: "saved" } as Run;
    window.testWorkspace = { api: { turnDiff: async (id: string, options?: TurnDiffOptions) => {
      assert(id === run.id, "Saved diff read another turn"); reads.push(options);
      return { available: true, patch: options?.summaryOnly ? "" : patch, patchTruncated: !options?.relative, files: [{ path: "last.ts", status: "added", added: 1, removed: 0 }] };
    } }, setConfirm: () => {}, setNotice: () => {} };
    root.render(<TurnOutcome run={run} />);
    await until(() => host.querySelector(".changed-file-row"));
    assert(reads.length === 1 && reads[0]?.summaryOnly, "Turn mount requested the whole patch");
    host.querySelector<HTMLButtonElement>(".changed-file-row")!.click();
    await until(() => host.querySelector(".diff-row--add"));
    assert(reads[1]?.relative === "last.ts", "File click did not request its own bounded patch");
    click("All changed files");
    await until(() => host.textContent?.includes("Preview limited to 512 KB"));
    assert(host.querySelector(".changed-file-row"), "Truncated patch hid the usable file summary");
    root.unmount(); root = createRoot(host);

    let status: UpdateCheck = { state: "ready-to-install", current: "0.6.0", latest: "0.7.0" };
    let event!: (payload: unknown) => void;
    let stale!: (value: UpdateCheck) => void;
    let initial = true;
    let installs = 0;
    let confirm!: () => Promise<void>;
    window.testWorkspace = { api: {
      on: (_name: string, handler: typeof event) => { event = handler; return () => {}; },
      updateStatus: async () => { if (initial) { initial = false; return new Promise<UpdateCheck>((resolve) => { stale = resolve; }); } return status; },
      installUpdate: async () => { installs++; status = { ...status, state: "installing" }; return true; },
    }, setConfirm: (value: { onConfirm: () => Promise<void> }) => { confirm = value.onConfirm; } };
    root.render(<AboutCard />);
    await until(() => stale);
    event({ command: "update-status" });
    await until(() => host.textContent?.includes("Restart & install"));
    stale({ state: "up-to-date", current: "0.5.0" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(host.textContent?.includes("Version 0.6.0") && host.textContent.includes("Restart & install"), "Old initial state replaced a downloaded update");
    click("Restart & install");
    assert(installs === 0 && confirm, "Restart bypassed save-work confirmation");
    await confirm();
    await until(() => host.textContent?.includes("Preparing restart"));
    assert(Number(installs) === 1, "About failed to use the in-app installer");
    root.unmount(); root = createRoot(host);

    // Both entry points must show and copy the running version, even when
    // release discovery is offline. A newer available version is not installed.
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    let copied = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
    try {
      for (const modal of [false, true]) {
        copied = "";
        window.testWorkspace = { api: {
          on: () => () => {},
          updateStatus: async () => ({ state: "unreachable", current: "1.8.2", latest: "1.9.0", detail: "Offline" }),
        } };
        root.render(modal ? <AboutModal open onClose={() => {}} /> : <AboutCard />);
        await until(() => host.textContent?.includes("Version 1.8.2"));
        const actions = host.querySelector('.about-modal-actions')!;
        const [copyRect, updateRect] = Array.from(actions.querySelectorAll('button')).map((button) => button.getBoundingClientRect());
        assert(copyRect && updateRect && Math.abs(copyRect.top - updateRect.top) <= 1,
          `About action buttons are not aligned (${modal ? "modal" : "card"}): copy=${JSON.stringify(copyRect)}, update=${JSON.stringify(updateRect)}`);
        const statusRect = host.querySelector('[role="status"]')!.getBoundingClientRect();
        assert(statusRect.top >= copyRect.bottom, "About status is beside or overlapping the action row");
        click("Copy version info");
        await until(() => copied.length > 0);
        assert(copied.startsWith("Capsule: 1.8.2\nGateway protocol: 4\n"), "About copied a placeholder or available release instead of the running version");
        root.unmount(); root = createRoot(host);
      }
      window.testWorkspace = { api: { on: () => () => {}, updateStatus: async () => { throw new Error("Version status unavailable"); } } };
      root.render(<AboutCard />);
      await until(() => host.textContent?.includes("Version unavailable"));
      const copy = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Copy version info");
      assert(copy?.disabled, "Unavailable version can be copied as if it were known");
      root.unmount(); root = createRoot(host);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }

    // Render inside the actual inspector: its global heading styles caused
    // the uppercase empty state, and its switch omitted the Agents surface.
    const base = { project: { id: "p", name: "Fixture" }, projectId: "p", session: { id: "s", harnessState: "closed", openclawSessionKey: "direct:acp:fixture" },
      runs: [], events: [], agents: [], files: [], steps: [], artifacts: [], harnesses: [], harnessSessions: [], stoppingRunIds: [],
      inspectorTab: "agents", settings: {}, setInspectorOpen: () => {}, api: {}, setView: () => {} };
    window.testWorkspace = base;
    localStorage.setItem("capsule.inspectorWidth", "360");
    root.render(<Inspector />);
    await until(() => host.querySelector(".thread-agents-empty h4"));
    assert(!host.textContent?.includes("Quick launch"), "Agents still shows launcher context");
    assert(host.textContent?.includes("Direct"), "Closed direct session lost historical route");
    const heading = host.querySelector<HTMLElement>(".thread-agents-empty h4")!;
    assert(getComputedStyle(heading).textTransform === "none", "Inspector overrode Agents empty-state typography");
    const taskRun = { id: "r", sessionId: "s", projectId: "p", agentId: "fixture", status: "running", prompt: "Inspect changes" } as Run;
    window.testWorkspace = { ...base, runs: [taskRun], eventLoad: { runId: "r", state: "loading" } };
    root.render(<Inspector />);
    await until(() => host.textContent?.includes("Loading activity"));
    assert(getComputedStyle(host.querySelector(".thread-agent-card")!).borderTopStyle === "solid", "Agents card border token is invalid");
    assert(getComputedStyle(host.querySelector(".thread-agent-heading .agent-glyph")!).marginLeft === "0px", "Fallback agent mark pushes its name to the right");
    window.testWorkspace = { ...window.testWorkspace, eventLoad: { runId: "r", state: "loaded" }, events: [{ runId: "r", type: "tool", data: { toolCallId: "child", status: "completed", delegation: { role: "reviewer", background: true, totalTokens: 0 } } }] };
    root.render(<Inspector />);
    await until(() => host.textContent?.includes("Launch completed · child status unknown"));
    assert(host.textContent?.includes("0 reported tokens"), "Reported zero usage became unknown");
    for (const size of [16, 20]) {
      document.documentElement.style.fontSize = `${size}px`;
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const card = host.querySelector<HTMLElement>(".thread-agent-card")!;
      assert(card.scrollWidth <= card.clientWidth + 1, "Agents content overflows at larger text size");
    }
  } finally {
    root.unmount(); window.testWorkspace = original;
    document.documentElement.style.removeProperty("font-size");
  }
}
