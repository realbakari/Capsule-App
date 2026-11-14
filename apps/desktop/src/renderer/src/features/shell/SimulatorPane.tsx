import { useToasts } from "../../lib/toasts";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Simulator, SimulatorAction, SimulatorApp, SimulatorFrame, SimulatorInventory, SimulatorOrientation } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { SimulatorAttach } from "./SimulatorAttach";
import { SimulatorTools } from "./SimulatorTools";
import { SimulatorAnnotator } from "./SimulatorAnnotator";
import { InspectorHeadSlot } from "./inspector-slot";
import { SimulatorSetup } from "./SimulatorSetup";
import { agentSimulatorActivity } from "../../lib/simulator-activity";
import { deviceGeometry, devicePoints, pointOnScreen, rotateClockwise, stepZoom, type SimulatorZoom, type Size } from "./simulator-geometry";
import {
  CameraIcon,
  ChevronDownIcon,
  HomeIcon,
  PencilIcon,
  RotateClockwiseIcon,
  SmartphoneIcon,
  VideoIcon,
  ZoomActualIcon,
  ZoomFitIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "./icons";

/**
 * A live iOS Simulator beside the thread. The phone frame is always drawn;
 * what fills it depends on the device. Before the user attaches a device the
 * screen is the attach card, which is also the consent for this thread's
 * agent to see and drive it. Attached and booted, the screen is a stream of
 * still frames captured by `simctl`, a few per second; it is not video, and
 * the panel never pretends otherwise.
 */

const LAST_DEVICE_KEY = "capsule.simulator.udid";
const ATTACHED_KEY = "capsule.simulator.attached";
/** Pause between one frame landing and the next request. ~2 frames/second with capture time. */
const FRAME_GAP_MS = 350;
const INVENTORY_POLL_MS = 5_000;
/** Pointer travel below this is a tap; above it, a swipe. */
const SWIPE_THRESHOLD_PX = 8;
/** Keystrokes typed into the focused screen go out together after this pause. */
const TYPE_FLUSH_MS = 120;
/** Room kept below the device for the floating toolbar, in CSS pixels. */
const TOOLBAR_ROOM = 60;
const STAGE_PADDING = 12;

type Tool = "none" | "url" | "apps" | "type" | "tools";

function remembered(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}

function remember(key: string, value: string | undefined): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* Optional preference. */ }
}

function stateLabel(state: Simulator["state"]): string {
  return state === "Shutting Down" ? "Shutting down" : state;
}

interface PointerTrack {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
}

export function SimulatorPane() {
  const { api, session, settings, setNotice, openPath, attachImage, activeRun, events } = useWorkspace();
  const { show: showToast } = useToasts();
  const headSlot = useContext(InspectorHeadSlot);
  const threadId = session?.id;
  const attachedKey = `${ATTACHED_KEY}:${threadId ?? "inbox"}`;
  const [inventory, setInventory] = useState<SimulatorInventory>();
  const [inventoryError, setInventoryError] = useState<string>();
  const [udid, setUdid] = useState<string | undefined>(() => remembered(LAST_DEVICE_KEY));
  const [attached, setAttached] = useState<string | undefined>(() => remembered(attachedKey));
  const [attaching, setAttaching] = useState(false);
  const [attachMenu, setAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<SimulatorFrame>();
  const [frameError, setFrameError] = useState<string>();
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [tool, setTool] = useState<Tool>("none");
  const [url, setUrl] = useState("");
  const [typed, setTyped] = useState("");
  const [apps, setApps] = useState<SimulatorApp[]>();
  const [appsError, setAppsError] = useState<string>();
  const [connectError, setConnectError] = useState<string>();
  const [zoom, setZoom] = useState<SimulatorZoom>("fit");
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<SimulatorOrientation>("portrait");
  const [menu, setMenu] = useState<"edit" | "device" | "view">();
  /* The frame held still while marking it up; undefined when not annotating. */
  const [annotating, setAnnotating] = useState<SimulatorFrame>();
  const stageRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typedBuffer = useRef("");
  const typeTimer = useRef(0);
  const screenRef = useRef<HTMLImageElement>(null);
  const track = useRef<PointerTrack | undefined>(undefined);
  const connecting = useRef<string | undefined>(undefined);
  const refreshInventory = useRef<() => void>(() => {});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const device = useMemo(() => inventory?.devices.find((item) => item.udid === udid), [inventory, udid]);
  /* Re-read every few seconds while a turn runs, so the banner clears once the agent's simulator steps stop. */
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!activeRun) return undefined;
    const id = window.setInterval(() => setClock(Date.now()), 3000);
    return () => window.clearInterval(id);
  }, [activeRun]);
  const agentUsing = useMemo(
    () => agentSimulatorActivity(events ?? [], activeRun?.id, device ? { udid: device.udid, name: device.name } : undefined, Date.now()),
    [events, activeRun?.id, device, clock],
  );
  /* Running devices first, then the rest by newest runtime: the device being worked on is near the top. */
  const grouped = useMemo(() => {
    const byRuntime = (a: Simulator, b: Simulator) => b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) || a.name.localeCompare(b.name);
    const devices = inventory?.devices ?? [];
    return {
      running: devices.filter((item) => item.state === "Booted" || item.state === "Booting").sort(byRuntime),
      available: devices.filter((item) => item.state !== "Booted" && item.state !== "Booting").sort(byRuntime),
    };
  }, [inventory]);
  useEffect(() => {
    if (!attachMenu) return;
    const outside = (event: PointerEvent) => { if (!attachMenuRef.current?.contains(event.target as Node)) setAttachMenu(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setAttachMenu(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [attachMenu]);
  const booted = device?.state === "Booted";
  const touch = device?.touch;
  const canTouch = touch?.state === "ready";
  const isAttached = Boolean(device && attached === device.udid);
  const agentAccess = settings?.agentSimulatorAccess !== false;

  /* Inventory: on open and every few seconds, single-flight, keeping the last good list on failure. */
  useEffect(() => {
    let disposed = false;
    let running = false;
    const refresh = () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      void api.listSimulators()
        .then((next) => { if (!disposed) { setInventory(next); setInventoryError(undefined); } })
        .catch((error) => { if (!disposed) setInventoryError(formatUserError(error)); })
        .finally(() => { running = false; });
    };
    refresh();
    refreshInventory.current = refresh;
    const timer = window.setInterval(refresh, INVENTORY_POLL_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); refreshInventory.current = () => {}; };
  }, [api]);

  /* The attachment follows the thread: each conversation attaches its own device. */
  useEffect(() => {
    const saved = remembered(attachedKey);
    setAttached(saved);
    if (saved) setUdid(saved);
  }, [attachedKey]);

  /* Tell main which device this thread's agent may use. Repeated on mount so a restart keeps the grant. */
  useEffect(() => {
    if (!threadId || api.isDesktop === false) return;
    void api.attachSimulator(threadId, attached).catch(() => undefined);
  }, [api, attached, threadId]);

  /* Default to the attached device, else the booted one, else the first, once the list arrives. */
  useEffect(() => {
    if (!inventory?.devices.length) return;
    if (udid && inventory.devices.some((item) => item.udid === udid)) return;
    const first = inventory.devices.find((item) => item.state === "Booted") ?? inventory.devices[0];
    if (first) setUdid(first.udid);
  }, [inventory, udid]);

  useEffect(() => {
    if (!udid) return;
    remember(LAST_DEVICE_KEY, udid);
    setFrame(undefined);
    setFrameError(undefined);
    setApps(undefined);
    setTool("none");
    setConnectError(undefined);
  }, [udid]);

  /* The screen: request a frame, wait a beat after it lands, request the next. */
  useEffect(() => {
    if (!udid || !booted || !live || !isAttached) return;
    let disposed = false;
    let timer = 0;
    const tick = () => {
      if (disposed) return;
      if (document.visibilityState === "hidden") { timer = window.setTimeout(tick, 1_000); return; }
      void api.simulatorScreen(udid)
        .then((next) => { if (!disposed) { setFrame(next); setFrameError(undefined); } })
        .catch((error) => { if (!disposed) setFrameError(formatUserError(error)); })
        .finally(() => { if (!disposed) timer = window.setTimeout(tick, FRAME_GAP_MS); });
    };
    tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, [api, udid, booted, live, isAttached]);

  const act = useCallback(async (action: SimulatorAction, label?: string): Promise<unknown> => {
    if (!udid) return undefined;
    if (label) setBusy(label);
    try {
      return await api.simulatorAction(udid, action);
    } catch (error) {
      setNotice(formatUserError(error));
      return undefined;
    } finally {
      if (mounted.current && label) setBusy(undefined);
    }
  }, [api, setNotice, udid]);

  /*
   * Touch input: ask main to build (first time) and start the bridge for the
   * device being watched. Once per device per failure; a failed attempt shows
   * its reason with Retry rather than looping.
   */
  const connectTouch = useCallback((target: string) => {
    if (connecting.current === target) return;
    connecting.current = target;
    setConnectError(undefined);
    void api.simulatorAction(target, { type: "connect" })
      .catch((error) => { if (mounted.current) setConnectError(formatUserError(error)); })
      .finally(() => { if (connecting.current === target) connecting.current = undefined; refreshInventory.current(); });
  }, [api]);

  useEffect(() => {
    if (!udid || !booted || !isAttached || !touch || connectError) return;
    if (touch.state === "idle") connectTouch(udid);
  }, [booted, connectError, connectTouch, isAttached, touch, udid]);

  /** Attach: start the device if needed, remember the choice for this thread, and connect touch. */
  const attach = async (target: string) => {
    setUdid(target);
    setAttaching(true);
    try {
      const current = inventory?.devices.find((item) => item.udid === target);
      if (current?.state === "Shutdown") await api.simulatorAction(target, { type: "boot" });
      remember(attachedKey, target);
      setAttached(target);
      const next = await api.listSimulators();
      if (mounted.current) setInventory(next);
    } catch (error) {
      setNotice(formatUserError(error));
    } finally {
      if (mounted.current) setAttaching(false);
    }
  };

  const detach = () => {
    // A recording left running after detach had no control anywhere to stop it.
    if (device?.recording) void stopRecording();
    remember(attachedKey, undefined);
    setAttached(undefined);
    setTool("none");
  };

  const openApps = async () => {
    if (tool === "apps") { setTool("none"); return; }
    setTool("apps");
    if (apps || !udid) return;
    try {
      setApps(await api.listSimulatorApps(udid));
      setAppsError(undefined);
    } catch (error) {
      setAppsError(formatUserError(error));
    }
  };

  const openTools = () => {
    if (tool === "tools") { setTool("none"); return; }
    setTool("tools");
    if (!apps && udid) void api.listSimulatorApps(udid).then(setApps).catch(() => undefined);
  };

  const family = device?.family ?? "iPhone";
  const points = devicePoints(frame, family);
  /* The stage's free space, minus padding and the toolbar's room, is what "fit" fills. */
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const measure = () => setStage({ width: element.clientWidth - 2 * STAGE_PADDING, height: element.clientHeight - 2 * STAGE_PADDING - TOOLBAR_ROOM });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [device?.udid]);
  const geometry = deviceGeometry(points, family, stage, zoom);
  const zoomStep = (direction: "in" | "out") => setZoom(stepZoom(geometry.scale, direction));

  /* Rotation starts from what the device reports, then follows the button. */
  useEffect(() => {
    if (!udid || !booted || !isAttached) return;
    void api.readSimulatorSettings(udid).then((next) => { if (mounted.current && next.orientation) setOrientation(next.orientation); }).catch(() => undefined);
  }, [api, udid, booted, isAttached]);
  const rotate = () => {
    if (!udid) return;
    // Read back what the device reports rather than assuming the turn landed.
    void act({ type: "rotate", orientation: rotateClockwise(orientation) }, "rotate")
      .then(() => api.readSimulatorSettings(udid))
      .then((next) => { if (mounted.current && next.orientation) setOrientation(next.orientation); })
      .catch(() => undefined);
  };

  useEffect(() => {
    if (!menu) return;
    const outside = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(undefined); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(undefined); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menu]);

  /** Map a pointer position on the drawn screen back to device points. */
  const toPoints = (clientX: number, clientY: number) => {
    const image = screenRef.current;
    return image ? pointOnScreen(clientX, clientY, image.getBoundingClientRect(), points) : undefined;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLImageElement>) => {
    if (!canTouch || !booted || event.button !== 0) return;
    // Keep the drag even when it leaves the frame. Best effort: a pointer
    // that is already gone has nothing to capture.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* No active pointer. */ }
    track.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startedAt: performance.now() };
  };

  const onPointerUp = (event: React.PointerEvent<HTMLImageElement>) => {
    const started = track.current;
    track.current = undefined;
    if (!started || started.pointerId !== event.pointerId) return;
    const from = toPoints(started.startX, started.startY);
    const to = toPoints(event.clientX, event.clientY);
    if (!from) return;
    const travelled = Math.hypot(event.clientX - started.startX, event.clientY - started.startY);
    if (travelled < SWIPE_THRESHOLD_PX || !to) {
      void act({ type: "tap", x: from.x, y: from.y });
    } else {
      const durationMs = Math.min(Math.max(performance.now() - started.startedAt, 80), 2_000);
      void act({ type: "swipe", fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, durationMs });
    }
  };

  /*
   * With the screen focused, the keyboard types into the device: characters
   * go out together after a short pause, Return and Delete as keys.
   */
  const flushTyped = () => {
    window.clearTimeout(typeTimer.current);
    const text = typedBuffer.current;
    typedBuffer.current = "";
    if (text) void act({ type: "text", text });
  };
  useEffect(() => () => window.clearTimeout(typeTimer.current), []);
  const onScreenKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    /* Device keys while the screen has focus: ⌘⇧H Home, ⌘→ rotate, ⌘S screenshot into the message. */
    if (event.metaKey && !event.altKey && !event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (event.shiftKey && key === "h" && canTouch) { event.preventDefault(); void act({ type: "button", name: "HOME" }, "home"); return; }
      if (!event.shiftKey && event.key === "ArrowRight" && canTouch) { event.preventDefault(); rotate(); return; }
      if (!event.shiftKey && key === "s") { event.preventDefault(); void screenshot(addPng); return; }
    }
    if (!canTouch || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter") { event.preventDefault(); flushTyped(); void act({ type: "key", key: "return" }); return; }
    if (event.key === "Backspace") { event.preventDefault(); flushTyped(); void act({ type: "key", key: "delete" }); return; }
    if (event.key.length !== 1) return;
    event.preventDefault();
    typedBuffer.current += event.key;
    window.clearTimeout(typeTimer.current);
    typeTimer.current = window.setTimeout(flushTyped, TYPE_FLUSH_MS);
  };

  const framePng = async (source: SimulatorFrame): Promise<Uint8Array> => {
    const image = new Image();
    image.src = source.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("The screenshot could not be encoded."))), "image/png"));
    return new Uint8Array(await blob.arrayBuffer());
  };

  const copyPng = async (png: Uint8Array) => {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(png)], { type: "image/png" }) })]);
    showToast({ key: "simulator", tone: "success", title: "Screenshot copied" });
  };
  const addPng = async (png: Uint8Array) => {
    if (await attachImage(png)) showToast({ key: "simulator", tone: "success", title: "Screenshot added to your message" });
  };

  /** A fresh frame, not the last one shown, sent where the person chose. */
  const screenshot = async (send: (png: Uint8Array) => Promise<void>) => {
    if (!udid) return;
    setBusy("screenshot");
    try {
      await send(await framePng(await api.simulatorScreen(udid)));
    } catch (error) {
      setNotice(formatUserError(error));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };

  const startAnnotating = async () => {
    if (!udid) return;
    setMenu(undefined);
    try {
      setAnnotating(await api.simulatorScreen(udid));
    } catch (error) {
      setNotice(formatUserError(error));
    }
  };
  const finishAnnotating = (send: (png: Uint8Array) => Promise<void>) => async (png: Uint8Array) => {
    try {
      await send(png);
      setAnnotating(undefined);
    } catch (error) {
      setNotice(formatUserError(error));
    }
  };

  async function stopRecording() {
    const result = (await act({ type: "record", mode: "stop" }, "record")) as { file?: string } | undefined;
    refreshInventory.current();
    if (result?.file) {
      const file = result.file;
      showToast({ key: "simulator", tone: "success", title: "Recording saved", detail: file, action: { label: "Open", run: () => openPath(file) } });
    }
  }

  const toggleRecording = async () => {
    if (!device) return;
    if (device.recording) {
      await stopRecording();
    } else {
      await act({ type: "record", mode: "start" }, "record");
      refreshInventory.current();
    }
  };

  const openTool = (next: Tool) => {
    setMenu(undefined);
    if (next === "apps") { void openApps(); return; }
    if (next === "tools") { openTools(); return; }
    setTool(tool === next ? "none" : next);
  };

  /* On a Mac the missing piece is Xcode, which the setup steps walk through and tick off. */
  if (inventory && !inventory.supported && /Mac/.test(navigator.userAgent) && !/needs macOS/.test(inventory.reason ?? "")) {
    return <SimulatorSetup inventory={inventory} onCopy={(text) => void navigator.clipboard.writeText(text).then(() => setNotice("Command copied."), () => setNotice("Could not copy the command."))} />;
  }

  if (inventory && !inventory.supported) {
    return (
      <div className="panel-tool-pane simulator-empty">
        <SmartphoneIcon size={28} />
        <h3>Simulator is not available here</h3>
        <p>{inventory.reason}</p>
      </div>
    );
  }

  if (!inventory && !inventoryError) {
    return <div className="panel-tool-pane simulator-empty"><SmartphoneIcon size={28} /><p className="faint">Looking for simulators…</p></div>;
  }

  const devices = inventory?.devices ?? [];
  const showScreen = Boolean(device && booted && isAttached);
  /* The pane's menus, grouped the way a device window's are: what you do to the content, the device, and the view. */
  type MenuItem = { label: string; disabled?: boolean; run: () => void } | "separator";
  const run = (action: () => void) => () => { setMenu(undefined); action(); };
  const menus: Record<"edit" | "device" | "view", { label: string; items: MenuItem[] }> = {
    edit: { label: "Edit", items: [
      { label: "Copy a screenshot", disabled: !showScreen, run: run(() => void screenshot(copyPng)) },
      { label: "Add a screenshot to your message", disabled: !showScreen, run: run(() => void screenshot(addPng)) },
      { label: "Mark up the screen", disabled: !showScreen, run: () => void startAnnotating() },
      "separator",
      { label: "Type text…", disabled: !showScreen || !canTouch, run: () => openTool("type") },
    ] },
    device: { label: "Device", items: [
      { label: "Home", disabled: !showScreen || !canTouch, run: run(() => void act({ type: "button", name: "HOME" }, "home")) },
      { label: "Rotate clockwise", disabled: !showScreen || !canTouch, run: run(rotate) },
      "separator",
      { label: "Open a URL or deep link…", disabled: !showScreen, run: () => openTool("url") },
      { label: "Installed apps…", disabled: !showScreen, run: () => openTool("apps") },
      { label: "Device tools…", disabled: !showScreen, run: () => openTool("tools") },
      "separator",
      { label: "Open in the Simulator app", disabled: !udid, run: run(() => void act({ type: "reveal" }, "reveal")) },
      booted
        ? { label: "Shut down", disabled: busy === "shutdown", run: run(() => void act({ type: "shutdown" }, "shutdown").then(() => refreshInventory.current())) }
        : { label: "Start", disabled: device?.state !== "Shutdown" || busy === "boot", run: run(() => void act({ type: "boot" }, "boot").then(() => refreshInventory.current())) },
    ] },
    view: { label: "View", items: [
      { label: "Fit to the pane", disabled: !device, run: run(() => setZoom("fit")) },
      { label: "Actual size", disabled: !device, run: run(() => setZoom(1)) },
      { label: "Zoom in", disabled: !device || geometry.scale >= 2 - 0.001, run: run(() => zoomStep("in")) },
      { label: "Zoom out", disabled: !device || geometry.scale <= 0.5 + 0.001, run: run(() => zoomStep("out")) },
      "separator",
      { label: live ? "Pause the live screen" : "Resume the live screen", disabled: !showScreen, run: run(() => setLive((value) => !value)) },
      { label: "Capture one frame", disabled: !showScreen || live, run: run(() => { if (udid) void api.simulatorScreen(udid).then(setFrame).catch((error) => setFrameError(formatUserError(error))); }) },
    ] },
  };
  const shown = annotating ?? frame;
  const zoomLabel = zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;
  /* In the panel the menus share the header row with expand and close; elsewhere they sit in the device row. */
  const menubar = (
    <div className="simulator-menubar" role="menubar" aria-label="Simulator" ref={menuRef}>
          {(Object.keys(menus) as Array<keyof typeof menus>).map((key) => (
            <div key={key} className="simulator-menu">
              <button type="button" role="menuitem" className={`simulator-menu-trigger${menu === key ? " active" : ""}`} aria-haspopup="menu" aria-expanded={menu === key} disabled={!device} onClick={() => setMenu((open) => (open === key ? undefined : key))}>
                {menus[key].label}<ChevronDownIcon size={12} />
              </button>
              {menu === key && (
                <div className="preview-more-menu simulator-menu-list" role="menu" aria-label={menus[key].label}>
                  {menus[key].items.map((item, index) => item === "separator"
                    ? <div key={`sep-${index}`} className="preview-menu-sep" role="separator" />
                    : <button key={item.label} type="button" role="menuitem" className="preview-menu-item" disabled={item.disabled} onClick={item.run}>{item.label}</button>)}
                </div>
              )}
            </div>
          ))}
        </div>
  );

  return (
    <div className="panel-browser-pane simulator-pane" data-family={family}>
      <div className="simulator-head">
        <div className="simulator-picker">
          <button
            type="button"
            className="simulator-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
            disabled={devices.length === 0}
          >
            <span className="simulator-picker-copy">
              <b>{device?.name ?? (devices.length ? "Choose a simulator" : "No simulators")}</b>
              <small>{device ? device.runtime : inventoryError ? "List unavailable" : "Create one in Xcode"}</small>
            </span>
            <ChevronDownIcon size={14} />
          </button>
          {pickerOpen && (
            <div className="preview-more-menu simulator-picker-menu" role="listbox">
              {devices.map((item) => (
                <div key={item.udid} className="preview-menu-item-row simulator-device-row">
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.udid === udid}
                    className={`preview-menu-item${item.udid === udid ? " active" : ""}`}
                    onClick={() => { setUdid(item.udid); setPickerOpen(false); }}
                  >
                    <span className="simulator-device-name">{item.name}</span>
                    <small className="faint">{item.runtime} · {stateLabel(item.state)}{attached === item.udid ? " · Attached" : ""}</small>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        {headSlot ? createPortal(menubar, headSlot) : menubar}
        <div className="simulator-zoom" role="group" aria-label={`Zoom, ${zoomLabel}`}>
          <button type="button" className="preview-chrome-btn" title="Zoom out" aria-label="Zoom out" disabled={!device || geometry.scale <= 0.5 + 0.001} onClick={() => zoomStep("out")}><ZoomOutIcon size={16} /></button>
          <button type="button" className={`preview-chrome-btn${zoom === "fit" ? " active" : ""}`} title="Fit to the pane" aria-label="Fit to the pane" aria-pressed={zoom === "fit"} disabled={!device} onClick={() => setZoom("fit")}><ZoomFitIcon size={16} /></button>
          <button type="button" className={`preview-chrome-btn${zoom === 1 ? " active" : ""}`} title="Actual size" aria-label="Actual size" aria-pressed={zoom === 1} disabled={!device} onClick={() => setZoom(1)}><ZoomActualIcon size={16} /></button>
          <button type="button" className="preview-chrome-btn" title="Zoom in" aria-label="Zoom in" disabled={!device || geometry.scale >= 2 - 0.001} onClick={() => zoomStep("in")}><ZoomInIcon size={16} /></button>
        </div>
      </div>

      {inventoryError && !inventory && (
        <div className="simulator-banner error">{inventoryError}</div>
      )}

      {agentUsing.active && (
        <div className="simulator-banner agent" role="status">
          {agentUsing.device ? "The agent is using this device." : "The agent is working with a simulator."} Taps now change what it sees.
        </div>
      )}

      {device && (
        <div className="simulator-stage" ref={stageRef} data-zoom={zoom === "fit" ? "fit" : "scaled"}>
          <div className="simulator-stage-inner" style={{ padding: `${STAGE_PADDING}px ${STAGE_PADDING}px ${STAGE_PADDING + TOOLBAR_ROOM}px` }}>
            <div
              className="simulator-bezel"
              style={{ width: geometry.frame.width, height: geometry.frame.height, padding: geometry.border, borderRadius: geometry.screenRadius + geometry.border }}
            >
              {family === "iPhone" && (
                <span className="simulator-keys" aria-hidden="true">
                  <i className="simulator-key action" /><i className="simulator-key up" /><i className="simulator-key down" /><i className="simulator-key side" />
                </span>
              )}
              <div
                className="simulator-screen"
                style={{ borderRadius: geometry.screenRadius }}
                tabIndex={showScreen && canTouch ? 0 : undefined}
                aria-label={showScreen ? `${device.name} screen. Click to tap, drag to swipe, type to enter text.` : undefined}
                onKeyDown={onScreenKey}
              >
                {!showScreen ? (
                  <SimulatorAttach
                    device={device}
                    devices={devices}
                    supported={inventory?.supported !== false}
                    agentAccess={agentAccess}
                    busy={attaching || busy === "boot"}
                    menuOpen={attachMenu}
                    onAttach={(target) => void attach(target)}
                    onToggleMenu={() => setAttachMenu((open) => !open)}
                  />
                ) : shown ? (
                  <img
                    ref={screenRef}
                    src={shown.dataUrl}
                    alt={`${device.name} screen`}
                    draggable={false}
                    className={canTouch && !annotating ? "touchable" : undefined}
                    onPointerDown={annotating ? undefined : onPointerDown}
                    onPointerUp={annotating ? undefined : onPointerUp}
                    onPointerCancel={() => { track.current = undefined; }}
                  />
                ) : (
                  <div className="simulator-waiting"><span className="simulator-spinner" role="status" aria-label="Waiting for the first frame" /></div>
                )}
                {annotating && showScreen && (
                  <SimulatorAnnotator frame={annotating} onAdd={finishAnnotating(addPng)} onCopy={finishAnnotating(copyPng)} onCancel={() => setAnnotating(undefined)} />
                )}
              </div>
            </div>
          </div>
          {attachMenu && !showScreen && (
            <div className="preview-more-menu simulator-attach-menu" role="menu" ref={attachMenuRef}>
              {grouped.running.length > 0 && <div className="simulator-attach-menu-head">Running</div>}
              {grouped.running.map((item) => (
                <button key={item.udid} type="button" role="menuitem" className="preview-menu-item" onClick={() => { setAttachMenu(false); void attach(item.udid); }}>
                  <span className="simulator-device-name">{item.name}</span>
                  <small className="faint">{item.runtime}</small>
                </button>
              ))}
              {grouped.available.length > 0 && <div className="simulator-attach-menu-head">Available (will boot)</div>}
              {grouped.available.map((item) => (
                <button key={item.udid} type="button" role="menuitem" className="preview-menu-item" onClick={() => { setAttachMenu(false); void attach(item.udid); }}>
                  <span className="simulator-device-name">{item.name}</span>
                  <small className="faint">{item.runtime}</small>
                </button>
              ))}
            </div>
          )}

          {showScreen && !annotating && (
            <div className="simulator-dock">
              {frameError ? (
                <div className="simulator-banner error">{frameError}</div>
              ) : !canTouch && touch ? (
                <div className={`simulator-banner${touch.state === "failed" || connectError ? " error" : ""}`}>
                  {connectError
                    ? `Touch input failed: ${connectError}`
                    : touch.state === "building"
                      ? "Preparing touch input. Xcode is building a small helper, which takes a minute or two the first time."
                      : touch.state === "starting"
                        ? "Connecting touch input to this simulator…"
                        : touch.state === "failed"
                          ? `Touch input failed: ${touch.detail}`
                          : touch.state === "unavailable"
                            ? `View only. ${touch.detail}`
                            : "View only."}
                  {(touch.state === "failed" || connectError) && udid ? (
                    <button type="button" className="chip" onClick={() => connectTouch(udid)}>Retry</button>
                  ) : null}
                </div>
              ) : null}

              {tool === "url" && (
                <form
                  className="simulator-tool-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!url.trim()) return;
                    void act({ type: "openUrl", url: url.trim() }, "url").then(() => setTool((current) => (current === "url" ? "none" : current)));
                  }}
                >
                  <input type="text" className="preview-address-input" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://… or myapp://…" aria-label="URL to open on the simulator" spellCheck={false} autoFocus />
                  <button type="submit" className="chip" disabled={!url.trim() || busy === "url"}>Open</button>
                </form>
              )}

              {tool === "type" && (
                <form
                  className="simulator-tool-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!typed) return;
                    void act({ type: "text", text: typed }, "type").then(() => setTyped(""));
                  }}
                >
                  <input type="text" className="preview-address-input" value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Text to type into the focused field" aria-label="Text to type on the simulator" autoFocus />
                  <button type="submit" className="chip" disabled={!typed || busy === "type"}>Type</button>
                  <button type="button" className="chip" title="Press Return on the device" disabled={busy === "type"} onClick={() => void act({ type: "key", key: "return" }, "type")}>Return</button>
                </form>
              )}

              {tool === "apps" && (
                <div className="simulator-apps">
                  {appsError ? <p className="danger-text">{appsError}</p> : !apps ? <p className="faint">Reading installed apps…</p> : (
                    <div className="simulator-app-list">
                      {apps.filter((app) => app.type === "User").map((app) => (
                        <div key={app.bundleId} className="preview-menu-item-row">
                          <button type="button" className="preview-menu-item" onClick={() => void act({ type: "launch", bundleId: app.bundleId }, "launch").then(() => setTool((current) => (current === "apps" ? "none" : current)))}>
                            <span className="simulator-device-name">{app.name}</span>
                            <small className="faint mono">{app.bundleId}</small>
                          </button>
                          <button type="button" className="chip" title="Quit this app" onClick={() => void act({ type: "terminate", bundleId: app.bundleId })}>Quit</button>
                        </div>
                      ))}
                      {apps.every((app) => app.type !== "User") && <p className="faint">No apps installed by you yet. Build and run from Xcode, or install a .app with simctl.</p>}
                    </div>
                  )}
                </div>
              )}

              {tool === "tools" && (
                <SimulatorTools udid={device.udid} apps={apps} touchReady={canTouch} agentAccess={agentAccess} onDetach={detach} act={act} onClose={() => setTool("none")} />
              )}
            </div>
          )}

          {!annotating && (
            <div className="simulator-toolbar" role="toolbar" aria-label="Simulator controls">
              <button type="button" className="preview-chrome-btn" title={canTouch ? "Home (⌘⇧H)" : "Home needs touch input"} aria-label="Home" disabled={!showScreen || !canTouch || busy === "home"} onClick={() => void act({ type: "button", name: "HOME" }, "home")}>
                <HomeIcon size={17} />
              </button>
              <button type="button" className="preview-chrome-btn" title={canTouch ? "Rotate clockwise (⌘→)" : "Rotating needs touch input"} aria-label="Rotate clockwise" disabled={!showScreen || !canTouch || busy === "rotate"} onClick={rotate}>
                <RotateClockwiseIcon size={17} />
              </button>
              <span className="simulator-toolbar-sep" />
              <button type="button" className="preview-chrome-btn" title="Add a screenshot to your message (⌘S)" aria-label="Add a screenshot to your message" disabled={!showScreen || busy === "screenshot"} onClick={() => void screenshot(addPng)}>
                <CameraIcon size={17} />
              </button>
              <button type="button" className={`preview-chrome-btn${device.recording ? " recording" : ""}`} title={device.recording ? "Stop recording" : "Record the screen"} aria-label={device.recording ? "Stop recording" : "Record the screen"} aria-pressed={device.recording} disabled={busy === "record" || (!device.recording && !showScreen)} onClick={() => void toggleRecording()}>
                <VideoIcon size={17} />
              </button>
              <span className="simulator-toolbar-sep" />
              <button type="button" className="preview-chrome-btn" title="Mark up the screen" aria-label="Mark up the screen" disabled={!showScreen} onClick={() => void startAnnotating()}>
                <PencilIcon size={17} />
              </button>
            </div>
          )}
        </div>
      )}

      {!device && devices.length === 0 && inventory && (
        <SimulatorSetup
          inventory={inventory}
          onCopy={(text) => void navigator.clipboard.writeText(text).then(() => setNotice("Command copied."), () => setNotice("Could not copy the command."))}
        />
      )}
    </div>
  );
}
