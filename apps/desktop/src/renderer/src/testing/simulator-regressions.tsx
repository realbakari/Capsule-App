import { createRoot } from "react-dom/client";
import { Inspector } from "../features/shell/Inspector";
import type { Simulator, SimulatorAction, SimulatorFrame, SimulatorInventory, SimulatorTouch } from "@capsule/shared";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${check.toString()}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
const click = (label: string) => {
  const node = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label);
  assert(node, `No control called ${label}`);
  node.click();
};

/** A 2x1 JPEG is enough for an <img> to lay out; the frame reports a phone-sized framebuffer. */
const FRAME_DATA = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAIBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

const unavailable: SimulatorTouch = { state: "unavailable", detail: "Install Xcode to get touch input." };
const booted: Simulator = { udid: "1F0BAB41-6C6A-48F4-8D60-A0FA315A06B7", name: "iPhone 17 Pro Max", runtime: "iOS 26.4", family: "iPhone", state: "Booted", touch: unavailable, recording: false };
const asleep: Simulator = { udid: "0D11CEBC-A627-49D6-8720-B562C71A0979", name: "iPhone 17 Pro", runtime: "iOS 26.4", family: "iPhone", state: "Shutdown", touch: unavailable, recording: false };
const ATTACHED_KEY = "capsule.simulator.attached:thread-sim";

export async function runSimulatorRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const savedDevice = localStorage.getItem("capsule.simulator.udid");
  localStorage.removeItem("capsule.simulator.udid");
  localStorage.removeItem(ATTACHED_KEY);
  const root = createRoot(host);
  const actions: Array<{ udid: string; action: SimulatorAction }> = [];
  const attachments: Array<string | undefined> = [];
  const opened: string[] = [];
  const notices: string[] = [];
  let frames = 0;
  let recording = false;
  const withTouch = (touch: SimulatorTouch, devices: Simulator[] = [booted, asleep]): SimulatorInventory => ({ supported: true, devices: devices.map((device) => device.udid === booted.udid ? { ...device, touch, recording } : device) });
  let inventory: SimulatorInventory = withTouch(unavailable);
  const tabs: string[] = [];
  const api = {
    ...(base.api as object), isDesktop: true, platform: "darwin",
    listSimulators: async () => inventory,
    listSimulatorApps: async () => [{ bundleId: "com.example.Demo", name: "Demo", type: "User" }, { bundleId: "com.apple.Preferences", name: "Settings", type: "System" }],
    readSimulatorSettings: async () => ({ appearance: "light", contentSize: "medium", increaseContrast: false, recording }),
    attachSimulator: async (_thread: string, udid: string | undefined) => { attachments.push(udid); },
    simulatorScreen: async (udid: string): Promise<SimulatorFrame> => {
      frames += 1;
      const touch = inventory.devices.find((device) => device.udid === udid)?.touch;
      return { udid, dataUrl: FRAME_DATA, pixelWidth: 1320, pixelHeight: 2868, ...(touch?.state === "ready" ? { pointWidth: touch.width, pointHeight: touch.height } : {}), capturedAt: new Date().toISOString() };
    },
    simulatorAction: async (udid: string, action: SimulatorAction) => {
      actions.push({ udid, action });
      if (action.type === "record") { recording = action.mode === "start"; inventory = withTouch(inventory.devices.find((d) => d.udid === booted.udid)!.touch); return recording ? undefined : { file: "/tmp/sim.mp4" }; }
      return undefined;
    },
  };
  const fixture = {
    ...base, project: undefined, projectId: undefined, session: { id: "thread-sim" }, files: [], steps: [], artifacts: [], harnesses: [], harnessSessions: [],
    git: undefined, settings: { agentSimulatorAccess: true }, inspectorOpen: true, inspectorTab: "launcher", requestedFile: undefined, clearRequestedFile: () => {},
    setInspectorOpen: () => {}, setInspectorTab: (tab: string) => { tabs.push(tab); window.testWorkspace = { ...window.testWorkspace, inspectorTab: tab }; },
    setNotice: (notice: string) => notices.push(notice), openPath: async (target: string) => { opened.push(target); }, api,
  };
  try {
    // The chooser: no project is needed, but a paired viewer and a non-Mac are told why not.
    window.testWorkspace = fixture;
    root.render(<Inspector />); await settle();
    const card = () => Array.from(document.querySelectorAll<HTMLButtonElement>(".codex-launcher-card")).find((node) => node.textContent?.includes("Simulator"));
    assert(card() && !card()!.disabled, "Chooser hid the simulator without a project");
    window.testWorkspace = { ...fixture, api: { ...api, isDesktop: false } };
    root.render(<Inspector />); await settle();
    assert(card()?.disabled && card()?.textContent?.includes("Available in the desktop app."), "Paired viewer was offered a simulator");
    window.testWorkspace = { ...fixture, api: { ...api, platform: "win32" } };
    root.render(<Inspector />); await settle();
    assert(card()?.disabled && card()?.textContent?.includes("macOS"), "A non-Mac was offered a simulator without saying why");

    // Opening it: the booted device is chosen but nothing streams until the user attaches it.
    window.testWorkspace = fixture;
    root.render(<Inspector />); await settle();
    card()!.click();
    assert(tabs.at(-1) === "simulator", "Choosing Simulator did not select its tab");
    root.render(<Inspector />);
    await until(() => document.querySelector(".simulator-picker-trigger")?.textContent?.includes("iPhone 17 Pro Max"));
    await until(() => document.querySelector(".simulator-attach"));
    assert(document.querySelector(".simulator-bezel"), "Phone frame is missing before attach");
    assert(host.textContent?.includes("This simulator is running."), "Attach card did not state the device is running");
    assert(host.textContent?.includes("Xcode and Simulator installed"), "Attach card did not confirm Xcode");
    assert(host.textContent?.includes("agent control it"), "Attach card did not say the agent gets access");
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert(frames === 0, "Frames streamed before the device was attached");
    assert(document.querySelector<HTMLButtonElement>('[aria-label="Home"]')?.disabled, "Home was enabled before attach");
    click("Attach simulator");
    await until(() => attachments.at(-1) === booted.udid);
    assert(!actions.some((entry) => entry.action.type === "boot"), "Attaching a booted device tried to boot it");
    await until(() => document.querySelector(".simulator-screen img"));
    await until(() => frames >= 2);
    const banner = document.querySelector(".simulator-banner");
    assert(banner?.textContent?.includes("View only") && banner.textContent.includes("Install Xcode to get touch input."), "View-only pane did not say why touch input is missing");
    assert(!actions.some((entry) => entry.action.type === "connect"), "Pane tried to connect touch input that is unavailable");
    const screen = document.querySelector<HTMLImageElement>(".simulator-screen img")!;
    screen.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10, pointerId: 1, button: 0 }));
    screen.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 10, clientY: 10, pointerId: 1, button: 0 }));
    await settle();
    assert(actions.length === 0, "A view-only screen dispatched a tap");

    // Pausing stops the stream; the single-frame refresh is the way to get a new picture.
    const streamed = frames;
    click("Pause");
    await new Promise((resolve) => setTimeout(resolve, 600));
    const paused = frames;
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert(frames === paused && paused <= streamed + 1, "Pausing did not stop the frame stream");
    click("Refresh");
    await until(() => frames === paused + 1);

    // Controls that need no bridge still work, each as one typed action.
    click("Open a URL"); await settle();
    const urlInput = document.querySelector<HTMLInputElement>('[aria-label="URL to open on the simulator"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(urlInput, "myapp://home");
    urlInput.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    urlInput.form!.requestSubmit();
    await until(() => actions.some((entry) => entry.action.type === "openUrl" && entry.action.url === "myapp://home"));
    click("Installed apps");
    await until(() => document.querySelector(".simulator-app-list"));
    assert(host.textContent?.includes("Demo") && !host.textContent.includes("com.apple.Preferences"), "Installed apps listed system apps or missed the user's");

    // Recording: start, then stop opens the saved file.
    click("Record");
    await until(() => actions.some((entry) => entry.action.type === "record" && entry.action.mode === "start"));
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => document.querySelector('[aria-label="Stop recording"]'));
    click("Stop recording");
    await until(() => opened.includes("/tmp/sim.mp4"));

    // An idle bridge is connected automatically; building and failure are said out loud, with Retry.
    inventory = withTouch({ state: "idle" });
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => actions.some((entry) => entry.action.type === "connect" && entry.udid === booted.udid));
    inventory = withTouch({ state: "building", since: Date.now() });
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => document.querySelector(".simulator-banner")?.textContent?.includes("Preparing touch input"));
    inventory = withTouch({ state: "failed", detail: "xcodebuild exited with 65." });
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => document.querySelector(".simulator-banner")?.textContent?.includes("xcodebuild exited with 65."));
    const connects = actions.filter((entry) => entry.action.type === "connect").length;
    Array.from(document.querySelectorAll<HTMLButtonElement>(".simulator-banner button")).find((node) => node.textContent === "Retry")!.click();
    await until(() => actions.filter((entry) => entry.action.type === "connect").length === connects + 1);

    // With the bridge ready, a click is a tap in device points and a drag is a swipe.
    inventory = withTouch({ state: "ready", width: 440, height: 956 });
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => !document.querySelector(".simulator-banner"));
    await until(() => document.querySelector<HTMLButtonElement>('[aria-label="Home"]')?.disabled === false);
    const beforeResume = frames;
    click("Resume");
    // Points arrive with the next frame; a tap on the stale frame has nothing to map to.
    await until(() => frames > beforeResume + 1);
    await until(() => document.querySelector<HTMLImageElement>(".simulator-screen img")?.getBoundingClientRect().width);
    const image = document.querySelector<HTMLImageElement>(".simulator-screen img")!;
    const rect = image.getBoundingClientRect();
    const mid = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    image.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: mid.x, clientY: mid.y, pointerId: 2, button: 0 }));
    image.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: mid.x, clientY: mid.y, pointerId: 2, button: 0 }));
    await until(() => actions.some((entry) => entry.action.type === "tap"));
    const tap = actions.find((entry) => entry.action.type === "tap")!.action as { x: number; y: number };
    assert(Math.abs(tap.x - 220) < 2 && Math.abs(tap.y - 478) < 2, `Tap did not map to the screen centre in points: ${JSON.stringify(tap)}`);
    image.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: mid.x, clientY: mid.y, pointerId: 3, button: 0 }));
    image.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: mid.x, clientY: mid.y - rect.height / 4, pointerId: 3, button: 0 }));
    await until(() => actions.some((entry) => entry.action.type === "swipe"));
    const swipe = actions.find((entry) => entry.action.type === "swipe")!.action as { fromY: number; toY: number };
    assert(swipe.toY < swipe.fromY, "Drag upward did not become an upward swipe");

    // The Tools drawer reads the device back, changes one setting per action, and can detach.
    click("Device tools");
    await until(() => document.querySelector(".simulator-tools"));
    await until(() => host.textContent?.includes("medium"));
    click("Dark");
    await until(() => actions.some((entry) => entry.action.type === "appearance" && entry.action.style === "dark"));
    click("Landscape left");
    await until(() => actions.some((entry) => entry.action.type === "rotate" && entry.action.orientation === "landscapeLeft"));
    click("Clean 9:41");
    await until(() => actions.some((entry) => entry.action.type === "statusBar" && entry.action.mode === "clean"));
    assert(host.textContent?.includes("agent can see and drive"), "Tools drawer did not state the agent's access");
    click("Detach simulator");
    await until(() => attachments.at(-1) === undefined);
    await until(() => document.querySelector(".simulator-attach"));

    // A shut-down device shows the attach card with its state, and attaching boots it.
    document.querySelector<HTMLButtonElement>(".simulator-picker-trigger")!.click(); await settle();
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((node) => node.textContent?.includes("iPhone 17 Pro") && !node.textContent.includes("Max"))!.click();
    await until(() => host.textContent?.includes("This simulator is shut down. Attaching starts it."));
    assert(document.querySelector(".simulator-bezel"), "Phone frame disappeared for a shut-down device");
    click("Attach simulator");
    await until(() => actions.some((entry) => entry.action.type === "boot" && entry.udid === asleep.udid));
    await until(() => attachments.at(-1) === asleep.udid);

    // With agent access off in Settings, the card says so instead of promising control.
    window.testWorkspace = { ...window.testWorkspace, settings: { agentSimulatorAccess: false } };
    root.render(<Inspector />);
    await until(() => host.textContent?.includes("Agent access is off in Settings"));

    // Off macOS, or without Xcode, the pane says so instead of showing an empty list.
    inventory = { supported: false, reason: "The iOS Simulator needs macOS with Xcode installed.", devices: [] };
    document.dispatchEvent(new Event("visibilitychange"));
    await until(() => host.textContent?.includes("Simulator is not available here"));
    assert(notices.every((notice) => notice.startsWith("Recording saved")), `Unexpected notices: ${notices.join(" | ")}`);
    return "Simulator regressions passed";
  } finally {
    root.unmount();
    window.testWorkspace = previous;
    localStorage.removeItem(ATTACHED_KEY);
    if (savedDevice === null) localStorage.removeItem("capsule.simulator.udid");
    else localStorage.setItem("capsule.simulator.udid", savedDevice);
  }
}
