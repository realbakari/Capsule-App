import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Simulator, SimulatorAction, SimulatorApp, SimulatorFrame, SimulatorInventory } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { SimulatorAttach } from "./SimulatorAttach";
import { SimulatorTools } from "./SimulatorTools";
import {
  CameraIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  GridIcon,
  HomeIcon,
  KeyboardIcon,
  LinkIcon,
  PauseIcon,
  PlayIcon,
  PowerIcon,
  RefreshIcon,
  SmartphoneIcon,
  VideoIcon,
  WrenchIcon,
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
  const { api, session, settings, setNotice, openPath } = useWorkspace();
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
  const screenRef = useRef<HTMLImageElement>(null);
  const track = useRef<PointerTrack | undefined>(undefined);
  const connecting = useRef<string | undefined>(undefined);
  const refreshInventory = useRef<() => void>(() => {});
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const device = useMemo(() => inventory?.devices.find((item) => item.udid === udid), [inventory, udid]);
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

  /** Map a pointer position on the rendered frame back to device points. */
  const toPoints = (clientX: number, clientY: number): { x: number; y: number } | undefined => {
    const image = screenRef.current;
    if (!image || !frame?.pointWidth || !frame.pointHeight) return undefined;
    const rect = image.getBoundingClientRect();
    if (!rect.width || !rect.height) return undefined;
    const x = ((clientX - rect.left) / rect.width) * frame.pointWidth;
    const y = ((clientY - rect.top) / rect.height) * frame.pointHeight;
    if (x < 0 || y < 0 || x > frame.pointWidth || y > frame.pointHeight) return undefined;
    return { x, y };
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

  const copyScreenshot = async () => {
    if (!udid) return;
    setBusy("screenshot");
    try {
      // A fresh full-resolution-bounded frame, not the last one shown.
      const fresh = await api.simulatorScreen(udid);
      const blob = await (await fetch(fresh.dataUrl)).blob();
      const png = await new Promise<Blob>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          canvas.getContext("2d")?.drawImage(image, 0, 0);
          canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("The screenshot could not be encoded."))), "image/png");
        };
        image.onerror = () => reject(new Error("The screenshot could not be decoded."));
        image.src = URL.createObjectURL(blob);
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      setNotice("Simulator screenshot copied.");
    } catch (error) {
      setNotice(formatUserError(error));
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  };

  const toggleRecording = async () => {
    if (!device) return;
    if (device.recording) {
      const result = (await act({ type: "record", mode: "stop" }, "record")) as { file?: string } | undefined;
      refreshInventory.current();
      if (result?.file) {
        setNotice(`Recording saved to ${result.file}`);
        void openPath(result.file);
      }
    } else {
      await act({ type: "record", mode: "start" }, "record");
      refreshInventory.current();
    }
  };

  if (inventory && !inventory.supported) {
    return (
      <div className="codex-tool-pane simulator-empty">
        <SmartphoneIcon size={28} />
        <h3>Simulator is not available here</h3>
        <p>{inventory.reason}</p>
      </div>
    );
  }

  if (!inventory && !inventoryError) {
    return <div className="codex-tool-pane simulator-empty"><p className="faint">Looking for simulators…</p></div>;
  }

  const devices = inventory?.devices ?? [];
  const aspect = frame ? `${frame.pixelWidth} / ${frame.pixelHeight}` : device?.family === "iPad" ? "3 / 4" : "9 / 19.5";
  const showScreen = Boolean(device && booted && isAttached);

  return (
    <div className="codex-browser-pane simulator-pane" data-family={device?.family ?? "iPhone"}>
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
              <small>{device ? `${device.runtime} · ${stateLabel(device.state)}${isAttached ? " · Attached" : ""}` : inventoryError ? "List unavailable" : "Create one in Xcode"}</small>
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
        <div className="preview-actions-cluster">
          <button type="button" className="preview-chrome-btn" title="Open in the Simulator app" aria-label="Open in the Simulator app" disabled={!udid} onClick={() => void act({ type: "reveal" }, "reveal")}>
            <ExternalLinkIcon size={14} />
          </button>
        </div>
      </div>

      {inventoryError && !inventory && (
        <div className="simulator-banner error">{inventoryError}</div>
      )}

      {device && (
        <>
          <div className="simulator-stage">
            <div className="simulator-bezel" style={{ aspectRatio: aspect }}>
              {device.family === "iPhone" && (
                <span className="simulator-keys" aria-hidden="true">
                  <i className="simulator-key action" /><i className="simulator-key up" /><i className="simulator-key down" /><i className="simulator-key side" />
                </span>
              )}
              <div className="simulator-screen">
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
                ) : frame ? (
                  <img
                    ref={screenRef}
                    src={frame.dataUrl}
                    alt={`${device.name} screen`}
                    draggable={false}
                    className={canTouch ? "touchable" : undefined}
                    onPointerDown={onPointerDown}
                    onPointerUp={onPointerUp}
                    onPointerCancel={() => { track.current = undefined; }}
                  />
                ) : (
                  <div className="simulator-waiting"><span className="simulator-spinner" aria-label="Waiting for the first frame" /></div>
                )}
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
          </div>

          {!showScreen ? null : frameError ? (
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

          {showScreen && tool === "url" && (
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

          {showScreen && tool === "type" && (
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

          {showScreen && tool === "apps" && (
            <div className="simulator-apps">
              {appsError ? <p className="error-text">{appsError}</p> : !apps ? <p className="faint">Reading installed apps…</p> : (
                <div className="simulator-app-list">
                  {apps.filter((app) => app.type === "User").map((app) => (
                    <div key={app.bundleId} className="preview-menu-item-row">
                      <button type="button" className="preview-menu-item" onClick={() => void act({ type: "launch", bundleId: app.bundleId }, "launch").then(() => setTool((current) => (current === "apps" ? "none" : current)))}>
                        <span className="simulator-device-name">{app.name}</span>
                        <small className="faint mono">{app.bundleId}</small>
                      </button>
                      <button type="button" className="ghost" title="Quit this app" onClick={() => void act({ type: "terminate", bundleId: app.bundleId })}>Quit</button>
                    </div>
                  ))}
                  {apps.every((app) => app.type !== "User") && <p className="faint">No apps installed by you yet. Build and run from Xcode, or install a .app with simctl.</p>}
                </div>
              )}
            </div>
          )}

          {showScreen && tool === "tools" && (
            <SimulatorTools udid={device.udid} apps={apps} touchReady={canTouch} agentAccess={agentAccess} onDetach={detach} act={act} onClose={() => setTool("none")} />
          )}

          <div className="simulator-toolbar" role="toolbar" aria-label="Simulator controls">
            <button type="button" className="preview-chrome-btn" title={canTouch ? "Home" : "Home needs touch input"} aria-label="Home" disabled={!showScreen || !canTouch || busy === "home"} onClick={() => void act({ type: "button", name: "HOME" }, "home")}>
              <HomeIcon size={15} />
            </button>
            <button type="button" className="preview-chrome-btn" title={live ? "Pause the live screen" : "Resume the live screen"} aria-label={live ? "Pause" : "Resume"} disabled={!showScreen} onClick={() => setLive((value) => !value)}>
              {live ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
            </button>
            <button type="button" className="preview-chrome-btn" title="Capture a frame now" aria-label="Refresh" disabled={!showScreen || live} onClick={() => { if (udid) void api.simulatorScreen(udid).then(setFrame).catch((error) => setFrameError(formatUserError(error))); }}>
              <RefreshIcon size={15} />
            </button>
            <span className="simulator-toolbar-sep" />
            <button type="button" className="preview-chrome-btn" title="Copy a screenshot" aria-label="Copy a screenshot" disabled={!showScreen || busy === "screenshot"} onClick={() => void copyScreenshot()}>
              <CameraIcon size={15} />
            </button>
            <button type="button" className={`preview-chrome-btn${device.recording ? " active" : ""}`} title={device.recording ? "Stop recording" : "Record the screen"} aria-label={device.recording ? "Stop recording" : "Record"} disabled={!showScreen || busy === "record"} onClick={() => void toggleRecording()}>
              <VideoIcon size={15} />
            </button>
            <button type="button" className={`preview-chrome-btn${tool === "tools" ? " active" : ""}`} title="Device tools" aria-label="Device tools" disabled={!showScreen} onClick={openTools}>
              <WrenchIcon size={15} />
            </button>
            <span className="simulator-toolbar-sep" />
            <button type="button" className={`preview-chrome-btn${tool === "url" ? " active" : ""}`} title="Open a URL or deep link" aria-label="Open a URL" disabled={!showScreen} onClick={() => setTool(tool === "url" ? "none" : "url")}>
              <LinkIcon size={15} />
            </button>
            <button type="button" className={`preview-chrome-btn${tool === "apps" ? " active" : ""}`} title="Installed apps" aria-label="Installed apps" disabled={!showScreen} onClick={() => void openApps()}>
              <GridIcon size={15} />
            </button>
            <button type="button" className={`preview-chrome-btn${tool === "type" ? " active" : ""}`} title={canTouch ? "Type text" : "Typing needs touch input"} aria-label="Type text" disabled={!showScreen || !canTouch} onClick={() => setTool(tool === "type" ? "none" : "type")}>
              <KeyboardIcon size={15} />
            </button>
            <span className="simulator-toolbar-sep" />
            {booted ? (
              <button type="button" className="preview-chrome-btn" title="Shut down this simulator" aria-label="Shut down" disabled={busy === "shutdown"} onClick={() => void act({ type: "shutdown" }, "shutdown").then(() => refreshInventory.current())}>
                <PowerIcon size={15} />
              </button>
            ) : (
              <button type="button" className="preview-chrome-btn" title="Start this simulator" aria-label="Start" disabled={device.state !== "Shutdown" || busy === "boot"} onClick={() => void act({ type: "boot" }, "boot").then(() => refreshInventory.current())}>
                <PowerIcon size={15} />
              </button>
            )}
          </div>
        </>
      )}

      {!device && devices.length === 0 && inventory && (
        <div className="codex-tool-pane simulator-empty">
          <SmartphoneIcon size={28} />
          <h3>No simulators yet</h3>
          <p>Create one in Xcode under Window → Devices and Simulators, then it appears here.</p>
        </div>
      )}
    </div>
  );
}
