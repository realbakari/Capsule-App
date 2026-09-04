import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import fsp from "node:fs/promises";

/** Where releases are published. */
const UPDATE_REPO = "realbakari/Capsule-App";
import {
  id,
  num,
  optBool,
  optStr,
  parseArgs,
  str,
  type ArgParser,
} from "@capsule/contracts";
import path from "node:path";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  nativeTheme,
  powerMonitor,
  safeStorage,
  screen,
  powerSaveBlocker,
  shell,
  webContents,
} from "electron";
import type { CapsuleEngine } from "@capsule/core";
import { mergePath, readLoginShellEnvironment } from "@capsule/harness";
import electronUpdater from "electron-updater";
import type { BrowserTarget } from "./browser-tools";
import { startBrowserMcpServer, type BrowserMcpServer } from "./browser-mcp";
import { Updater, mergeUpdateStatus } from "./updater";
import {
  IPC_CHANNELS,
  isNewerRelease,
  pickReleaseAsset,
  PRESET_HARNESSES,
  type AttentionState,
  attentionLabel,
  summariseAttention,
  type MessageAttachment,
  type UpdateCheck,
  IPC_EVENTS,
  type ApprovalRequest,
  type CapsuleSettings,
  type HarnessId,
  type HarnessOptionPatch,
  type MonitoredProcess,
  type PopupMenuRequest,
  type RemoteAccess,
  type ResourceHistoryPoint,
  type ResourceSample,
  type Run,
  type SpawnHarnessInput,
  type UpdateProjectInput,
} from "@capsule/shared";
import { readAgentProcesses } from "@capsule/filesystem";
import { startRemoteServer, type RemoteServerHandle } from "@capsule/remote";
import { startPty, type PtySession } from "@capsule/terminal";
import { popupContextMenu } from "./popup-menu";
import { remoteReachFromArgs } from "./remote-args";
import {
  DEFAULT_WINDOW_SIZE,
  isHexColor,
  parseWindowState,
  restoreWindowBounds,
  type WindowState,
} from "./window-state";
import { ensureSqliteAbi } from "./sqlite-abi";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let engine: CapsuleEngine | undefined;
/*
 * The window is shown before the engine has opened its database, so the
 * renderer's first calls can arrive first. They used to be answered with
 * "Capsule engine is not ready" — a red banner over an empty app on every
 * cold start. They wait for it instead.
 */
let engineStarted: Promise<void> | undefined;
let awakeBlocker: number | undefined;

function loadLocalEnv(): void {
  const candidates = [
    path.join(process.cwd(), ".env.local"),
    path.join(process.cwd(), ".env"),
    path.join(path.resolve(__dirname, "../../.."), ".env.local"),
    path.join(path.resolve(__dirname, "../../.."), ".env"),
  ];
  for (const file of candidates) {
    if (existsSync(file)) {
      try {
        const lines = readFileSync(file, "utf8").split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
            if (key && !(key in process.env)) {
              process.env[key] = val;
            }
          }
        }
      } catch {
        // ignore read errors
      }
    }
  }
}

/*
 * Take the user's real environment, not a guess at it.
 *
 * Launched from the Dock, this process has the minimal PATH macOS hands a GUI
 * app. The hardcoded list this replaces was wrong on the first machine it met:
 * `grok` lives in ~/.grok/bin and `kimi` in ~/.kimi-code/bin, and neither was
 * on it — two harnesses Capsule ships, invisible when it was not started from
 * a terminal. The list stays as a floor for when the shell cannot be read.
 */
function augmentPath(): void {
  loadLocalEnv();
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    path.join(app.getPath("home"), ".local", "bin"),
    path.join(app.getPath("home"), ".claude", "bin"),
    path.join(app.getPath("home"), ".codex", "bin"),
  ].filter((dir) => existsSync(dir));

  const shellEnv = readLoginShellEnvironment();
  process.env.PATH = mergePath(shellEnv.PATH, process.env.PATH, extras.join(path.delimiter));
  // The rest only fills gaps: an explicit value in this process was set on
  // purpose and outranks the shell's.
  for (const [name, value] of Object.entries(shellEnv)) {
    if (name !== "PATH" && !process.env[name]) process.env[name] = value;
  }
}

/**
 * Image attachments, with a thumbnail the composer can actually show.
 *
 * nativeImage does the decoding and the downscale, so a 12MP screenshot
 * becomes a couple of kilobytes rather than being inlined whole. Anything that
 * is not a decodable image, or is too big to be worth reading, simply comes
 * back without one and keeps the generic file chip.
 */
const THUMBNAIL_SOURCE_LIMIT = 20 * 1024 * 1024;

function withThumbnails(attachments: MessageAttachment[]): MessageAttachment[] {
  return attachments.map((attachment) => {
    if (!attachment.mimeType?.startsWith("image/")) return attachment;
    if (attachment.size > THUMBNAIL_SOURCE_LIMIT) return attachment;
    try {
      const image = nativeImage.createFromPath(attachment.path);
      if (image.isEmpty()) return attachment;
      const { width, height } = image.getSize();
      if (!width || !height) return attachment;
      // Height-bounded, so a wide screenshot and a tall one both come back a
      // sensible size for a row of chips.
      const scaled = height > 96 ? image.resize({ height: 96, quality: "good" }) : image;
      return { ...attachment, thumbnail: scaled.toDataURL() };
    } catch {
      // A file we cannot decode is still a perfectly good attachment.
      return attachment;
    }
  });
}

/*
 * The browser pane's guest, if one is open. Resolved on each use rather than
 * held, so a destroyed page is never driven: the id outlives the contents.
 */
let browserViewId: number | undefined;

let browserMcp: BrowserMcpServer | undefined;

export const browserTarget: BrowserTarget = {
  contents: () => {
    if (browserViewId === undefined) return undefined;
    const contents = webContents.fromId(browserViewId);
    return contents && !contents.isDestroyed() ? contents : undefined;
  },
};

function userDataDir(): string {
  const dir = path.join(app.getPath("userData"), "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function resolveAsset(file: string): string | undefined {
  const candidates = [
    path.join(__dirname, "../../build", file),
    path.join(process.resourcesPath, file),
    path.join(app.getAppPath(), "build", file),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function loadIcon(file: string): Electron.NativeImage | undefined {
  const location = resolveAsset(file);
  if (!location) return undefined;
  const image = nativeImage.createFromPath(location);
  return image.isEmpty() ? undefined : image;
}

function preloadPath(): string {
  const candidates = [
    path.join(__dirname, "../preload/index.cjs"),
    path.join(__dirname, "../preload/index.js"),
    path.join(__dirname, "../preload/index.mjs"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Preload script missing. Looked in ${candidates.join(", ")}`);
  }
  return found;
}

function applyDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const icon = loadIcon("icon.png");
  if (icon) app.dock.setIcon(icon);
}


/**
 * Ask GitHub whether a newer release has been published.
 *
 * A manual check, not an auto-updater: installing an update in place needs the
 * build to be signed and notarised with the same identity as the running app,
 * and this project has no signing identity configured, so an updater would
 * download something macOS then refuses to launch. This reports honestly and
 * sends the user to the release page.
 */
/*
 * The in-place updater, when this build can be replaced.
 *
 * A packaged, signed app can swap itself; a development run cannot, and asking
 * electron-updater to try only produces an error to explain away. The GitHub
 * check below still runs either way, because a release published without an
 * update feed — every one before 0.3.0 — has nothing for the updater to read.
 */
let updater: Updater | undefined;

function ensureUpdater(): Updater {
  if (updater) return updater;
  updater = new Updater({
    updater: electronUpdater.autoUpdater,
    currentVersion: app.getVersion(),
    canInstall: app.isPackaged,
    /*
     * Progress arrives as events, and the renderer asks for the status when
     * it hears one rather than being handed a payload it might race with.
     */
    onStatus: () => send(IPC_EVENTS.state, { command: "update-status" }),
  });
  return updater;
}

/*
 * The last answer GitHub gave, kept so the cheap status call has the release
 * URL and notes to hand without asking for them again.
 */
let lastUpdateCheck: UpdateCheck | undefined;

async function checkForUpdates(): Promise<UpdateCheck> {
  const result = await fetchLatestRelease();
  lastUpdateCheck = result;
  return result;
}

async function fetchLatestRelease(): Promise<UpdateCheck> {
  const current = app.getVersion();
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "capsule-desktop" },
      signal: AbortSignal.timeout(8000),
    });
    // 404 is the honest answer for both "no releases yet" and "the repository
    // is not visible", and from here those are the same thing: there is
    // nothing this user can download.
    if (response.status === 404) {
      return { state: "no-releases", current };
    }
    if (!response.ok) {
      return { state: "unreachable", current, detail: `GitHub responded ${response.status}` };
    }
    const release = await response.json() as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown; }>;
    };
    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    if (!tag) return { state: "no-releases", current };
    if (!isNewerRelease(tag, current)) return { state: "up-to-date", current, latest: tag };
    const download = pickReleaseAsset(release.assets ?? [], process.arch);
    const notes = typeof release.body === "string" ? release.body.trim() : "";
    return {
      state: "update-available",
      current,
      latest: tag,
      url: release.html_url ?? `https://github.com/${UPDATE_REPO}/releases/latest`,
      ...(download ? { download } : {}),
      ...(notes ? { notes } : {}),
    };
  } catch (error) {
    return {
      state: "unreachable",
      current,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

const WINDOW_STATE_FILE = "window-state.json";

function windowStatePath(): string {
  return path.join(userDataDir(), WINDOW_STATE_FILE);
}

function readWindowState(): WindowState | undefined {
  try {
    return parseWindowState(JSON.parse(readFileSync(windowStatePath(), "utf8")));
  } catch {
    return undefined;
  }
}

/*
 * Written on move, resize and close. A window nobody saved opens at the
 * default size every launch, which is what made Capsule look like it opened
 * small and then jumped to the size you actually work in.
 */
/** The colour the renderer last painted, remembered for the next launch. */
let paintedBackground: string | undefined;

function saveWindowState(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
  const maximized = window.isMaximized();
  // Its normal frame, not the maximised one: unmaximising has to land
  // somewhere.
  const bounds = maximized ? window.getNormalBounds() : window.getBounds();
  try {
    writeFileSync(
      windowStatePath(),
      JSON.stringify({
        ...bounds,
        maximized,
        ...(paintedBackground ? { background: paintedBackground } : {}),
      }),
      "utf8",
    );
  } catch {
    // A window position is not worth failing over.
  }
}

function createWindow(): BrowserWindow {
  const saved = readWindowState();
  const restored = restoreWindowBounds(saved, screen.getAllDisplays());
  const window = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    ...(restored ?? {}),
    minWidth: 960,
    minHeight: 640,
    title: "Capsule",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    /*
     * The frame the window paints before the renderer has drawn anything. It
     * was always the dark base, so opening the app in light mode flashed
     * near-black, and even in dark mode it was a shade under every surface the
     * app then painted. `nativeTheme` is what the renderer will resolve
     * "system" to, so the two agree.
     */
    /*
     * The colour the app painted last time, when it is known. The palette is a
     * setting that only the renderer can resolve, and it does so several
     * frames after this window has already drawn itself — so guessing from the
     * system theme alone opened a #0a0a0a window in front of a #181818 app.
     */
    backgroundColor:
      saved?.background ?? (nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#f4f4f1"),
    // Shown once it has something to show: a window that appears before its
    // first paint is a flash of empty chrome no matter what colour it is.
    show: false,
    icon: loadIcon("icon.png"),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  window.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    if (!params.src) {
      event.preventDefault();
      return;
    }
    let protocol: string;
    try {
      protocol = new URL(params.src).protocol;
    } catch {
      event.preventDefault();
      return;
    }
    if (protocol !== "http:" && protocol !== "https:") {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
  });

  window.webContents.on("did-attach-webview", (_event, contents) => {
    contents.setWindowOpenHandler((details) => {
      void shell.openExternal(details.url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      try {
        const protocol = new URL(url).protocol;
        if (protocol !== "http:" && protocol !== "https:") event.preventDefault();
      } catch {
        event.preventDefault();
      }
    });
  });

  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.error(`Renderer failed to load (${code}) ${description} ${url}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone", details);
  });
  window.webContents.on("console-message", (_event, ...payload) => {
    console.error("[renderer]", ...payload);
  });

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  const rendererURL = process.env.ELECTRON_RENDERER_URL;
  if (rendererURL) {
    void window.loadURL(rendererURL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  // The renderer cannot see the window's fullscreen state, and it changes the
  // header layout, so push it on both transitions and once at startup.
  window.on("enter-full-screen", reportFullscreen);
  window.on("leave-full-screen", reportFullscreen);
  /*
   * Not shown on "ready-to-show": that fires on the renderer's first frame,
   * which for a dev build is the empty document Vite serves before React has
   * mounted. The window appeared blank and then filled in — the pop the app
   * seemed to do on every start. The renderer says when it has painted, and
   * these are the fallbacks for when it cannot.
   */
  if (saved?.maximized) window.maximize();

  let saveTimer: NodeJS.Timeout | undefined;
  const rememberBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    // A drag fires these continuously; the last one is the one that matters.
    saveTimer = setTimeout(() => saveWindowState(window), 400);
    saveTimer.unref?.();
  };
  window.on("resize", rememberBounds);
  window.on("move", rememberBounds);
  window.on("close", () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(window);
  });

  const showWhenPainted = () => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  };
  // The renderer signals rendererReady once React has settled data and completed two
  // animation frames. If the renderer crashes or fails to signal, fallback after 1500ms.
  window.once("ready-to-show", () => {
    const fallback = setTimeout(showWhenPainted, 1500);
    fallback.unref?.();
  });
  window.webContents.on("did-finish-load", () => {
    reportFullscreen();
    /*
     * The smoke test needs to know the app got as far as a loaded window.
     * Watching stderr for known failure strings is whack-a-mole — a main
     * process that dies during module load prints "App threw an error during
     * load", which matches none of them — so the check is positive instead.
     */
    if (process.env.CAPSULE_SMOKE_TEST) {
      // The count too: a second window nobody asked for is a startup bug the
      // smoke test can catch as easily as a crash.
      console.log(`capsule: window ready (${BrowserWindow.getAllWindows().length})`);
    }
  });

  return window;
}

/*
 * macOS hides the window controls in fullscreen, so the inset reserved for
 * them becomes dead space at the left of every header. Only the main process
 * knows the window's fullscreen state, so it tells the renderer and the
 * renderer collapses the inset.
 */
function reportFullscreen(): void {
  send(IPC_EVENTS.fullscreen, Boolean(mainWindow?.isFullScreen()));
}

/*
 * The shells behind the terminal panel. The renderer cannot hold a pty, so the
 * main process owns them and forwards their output by id.
 */
const terminals = new Map<string, PtySession>();

/*
 * Resource sampling.
 *
 * The panel used to sample only while it was open, which meant the spike you
 * opened it to investigate had already gone. Sampling runs on its own slow
 * ticker and keeps a bounded window, so the panel reads history rather than
 * starting a stopwatch.
 */
const SAMPLE_INTERVAL_MS = 5_000;
const HISTORY_WINDOW_MS = 15 * 60_000;
const MAX_HISTORY_POINTS = Math.ceil(HISTORY_WINDOW_MS / SAMPLE_INTERVAL_MS);

let latestSample: ResourceSample | undefined;
const resourceHistory: ResourceHistoryPoint[] = [];
let sampleTimer: NodeJS.Timeout | undefined;

/** The CLI names that mean an agent is running, from the harness catalog. */
const AGENT_BINARIES: ReadonlySet<string> = new Set([
  ...PRESET_HARNESSES.flatMap((preset) => preset.binaries),
  // The Gateway and the plugin that starts the harnesses. Their descendants
  // are the agent processes, so they are roots of the search either way.
  "openclaw",
  "acpx",
]);

function sampleResources(): ResourceSample {
  const now = Date.now();
  const appProcesses: MonitoredProcess[] = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    cpuPercent: metric.cpu?.percentCPUUsage ?? 0,
    memoryBytes: (metric.memory?.workingSetSize ?? 0) * 1024,
    // creationTime is epoch ms; a process that did not report one gets no
    // uptime rather than one measured from zero.
    uptimeMs: metric.creationTime ? now - metric.creationTime : undefined,
    name: metric.serviceName ?? metric.name ?? metric.type,
  }));
  const appPids = new Set(appProcesses.map((item) => item.pid));
  const agents = readAgentProcesses(AGENT_BINARIES, now)
    // Capsule's own helpers can match a harness name when a CLI is bundled
    // with the app; Electron already reported those.
    .filter((row) => !appPids.has(row.pid))
    .map((row) => ({
      pid: row.pid,
      name: row.name,
      cpuPercent: row.cpuPercent,
      memoryBytes: row.residentBytes,
      uptimeMs: row.elapsedSeconds * 1_000,
      startTimeMs: row.startTimeMs,
    }));

  const sample: ResourceSample = {
    sampledAt: now,
    app: appProcesses,
    agents,
    // ps reports every process it can see; the ones it cannot are the
    // difference between what it listed and what it could attribute.
    inaccessibleCount: 0,
  };
  latestSample = sample;
  resourceHistory.push({
    sampledAt: now,
    appCpuPercent: appProcesses.reduce((total, item) => total + item.cpuPercent, 0),
    appMemoryBytes: appProcesses.reduce((total, item) => total + item.memoryBytes, 0),
    agentCpuPercent: agents.reduce((total, item) => total + item.cpuPercent, 0),
    agentMemoryBytes: agents.reduce((total, item) => total + item.memoryBytes, 0),
    agentCount: agents.length,
  });
  // Bounded two ways: a clock that jumps backwards must not keep points
  // forever, and neither must a long-running window.
  const cutoff = now - HISTORY_WINDOW_MS;
  while (
    resourceHistory.length > MAX_HISTORY_POINTS ||
    (resourceHistory[0] && resourceHistory[0].sampledAt < cutoff)
  ) {
    resourceHistory.shift();
  }
  return sample;
}

function startResourceSampling(): void {
  if (sampleTimer) return;
  sampleResources();
  sampleTimer = setInterval(sampleResources, SAMPLE_INTERVAL_MS);
  // Sampling must never be the reason the app stays awake.
  sampleTimer.unref?.();
}

function stopTerminal(id: string): void {
  terminals.get(id)?.kill();
  terminals.delete(id);
}

function stopAllTerminals(): void {
  for (const id of [...terminals.keys()]) stopTerminal(id);
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
  for (const listener of remoteListeners) {
    try {
      listener(channel, payload);
    } catch {
      // A dead socket must not stop the window from being updated.
    }
  }
}

function windowFocused(): boolean {
  return Boolean(mainWindow?.isFocused());
}

function bounceDock(): void {
  if (process.platform !== "darwin" || !app.dock || windowFocused()) return;
  app.dock.bounce("informational");
}

function notifyDesktop(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function notifyApproval(approval: ApprovalRequest): void {
  const settings = engine?.getSettings();
  if (settings && !settings.notifyApprovals) return;
  notifyDesktop(
    "Approval required",
    `${approval.agentName} wants to ${approval.action} ${approval.target}`,
  );
  if (settings?.bounceDockOnAttention) bounceDock();
}

function notifyRunSettled(run: Run): void {
  if (!["completed", "failed", "cancelled"].includes(run.status)) return;
  const settings = engine?.getSettings();
  if (!settings?.notifyRunComplete) return;
  if (windowFocused()) return;
  const title =
    run.status === "completed" ? "Response complete" : run.status === "failed" ? "Run failed" : "Run cancelled";
  notifyDesktop(title, (run.prompt ?? "Task").slice(0, 140));
  if (settings.bounceDockOnAttention) bounceDock();
}

function desktopHasWork(): boolean {
  if (!engine) return false;
  const liveRun = engine
    .listRuns()
    .some((run) => ["running", "waiting", "approval_required"].includes(run.status));
  if (liveRun) return true;
  return engine
    .listSessions()
    .some(
      (session) =>
        session.harnessState === "spawning" ||
        session.harnessState === "running" ||
        session.harnessState === "waiting",
    );
}

function applyKeepAwake(settings?: CapsuleSettings): void {
  const enabled = Boolean(settings?.keepAwakeWhileRunning && desktopHasWork());
  if (enabled && awakeBlocker == null) {
    awakeBlocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!enabled && awakeBlocker != null) {
    powerSaveBlocker.stop(awakeBlocker);
    awakeBlocker = undefined;
  }
}

function applyMenuBar(settings?: CapsuleSettings): void {
  const show = settings?.showMenuBarExtra !== false;
  if (show && !tray) createTray();
  if (!show && tray) {
    tray.destroy();
    tray = undefined;
  }
}

function applyDesktopSettings(settings?: CapsuleSettings): void {
  applyLaunchAtLogin(Boolean(settings?.launchAtLogin));
  applyNativeTheme(settings?.appearanceTheme);
  applyMenuBar(settings);
  applyKeepAwake(settings);
  void applyRemoteAccess(settings?.remoteAccess ?? "off");
}

/*
 * Reading Capsule from another device.
 *
 * The listener exists only while this setting says so, and every call it
 * forwards is checked against the paired device's scopes — a viewer holding
 * "read" cannot reach a channel that runs a command, writes a file, or opens
 * a shell.
 */
let remote: RemoteServerHandle | undefined;
let remoteReach: RemoteAccess = "off";
let remotePairingUrl: string | undefined;
let remoteError: string | undefined;

async function applyRemoteAccess(reach: RemoteAccess): Promise<void> {
  if (reach === remoteReach) return;
  remoteReach = reach;
  remotePairingUrl = undefined;
  remoteError = undefined;
  await remote?.stop().catch(() => undefined);
  remote = undefined;
  if (reach !== "off") {
    try {
      remote = await startRemoteServer({
        serveDir: path.join(__dirname, "../renderer"),
        reach,
        invoke: (channel, args) => forwardToHandler(channel, args),
        subscribe: (emit) => subscribeRemote(emit),
        onChange: () => send(IPC_EVENTS.state, { command: "remote-updated" }),
      });
    } catch (error) {
      remoteError = error instanceof Error ? error.message : String(error);
    }
  }
  send(IPC_EVENTS.state, { command: "remote-updated" });
}

/*
 * The same handlers the window calls, recorded as they are registered. A
 * separate table for the remote path would be a second definition of what
 * Capsule can do, and the two would drift.
 */
const handlers = new Map<string, (...args: unknown[]) => unknown>();

async function forwardToHandler(channel: string, args: unknown[]): Promise<unknown> {
  /*
   * A paired device names a channel the way the bridge does — "listSessions",
   * the same word the scope table uses. The handlers are keyed by the wire
   * name ("capsule:listSessions"), so this is where the two meet. Anything
   * that is not a known name is refused rather than guessed at.
   */
  const wireName = IPC_CHANNELS[channel as keyof typeof IPC_CHANNELS];
  const handler = wireName ? handlers.get(wireName) : undefined;
  if (!handler) throw new Error(`Unknown channel ${channel}`);
  return await handler(...args);
}

/*
 * Started from a terminal, the pairing link belongs in that terminal. It is
 * the one place the token can be shown once and read by the person who asked
 * for it.
 */
async function announceRemoteAccess(): Promise<void> {
  const reach = remoteReachFromArgs(process.argv, process.env);
  if (!reach || reach === "off") return;
  await applyRemoteAccess(reach);
  if (!remote) {
    console.error(`Capsule could not start reading from another device: ${remoteError ?? "unknown"}`);
    return;
  }
  remotePairingUrl = remote.pair(["read"]);
  console.log(`\nCapsule is readable at ${remote.url}`);
  console.log(`Pair a device: ${remotePairingUrl}`);
  console.log("The link works once and expires in five minutes. Read only.\n");
  send(IPC_EVENTS.state, { command: "remote-updated" });
  /*
   * And open it, because a link printed in a terminal is a link somebody has
   * to copy. `--no-open` is for a machine with no browser to open it on, where
   * the printed link is the whole point.
   */
  if (!process.argv.includes("--no-open")) {
    void shell.openExternal(remotePairingUrl).catch(() => {
      console.log("Could not open a browser here — use the link above.");
    });
  }
}

const remoteListeners = new Set<(event: string, payload: unknown) => void>();

function subscribeRemote(emit: (event: string, payload: unknown) => void): () => void {
  remoteListeners.add(emit);
  return () => remoteListeners.delete(emit);
}

function registerIpc(): void {
  const requireEngine = () => {
    if (!engine) throw new Error("Capsule engine is not ready");
    return engine;
  };

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        // Startup, not an error: a call that beat the engine waits for it.
        if (!engine && engineStarted) await engineStarted;
        return await fn(...args);
      } catch (error) {
        console.error(`IPC ${channel} failed`, error);
        throw error;
      }
    });
  };

  /**
   * `handle` with the arguments checked first.
   *
   * The untyped form coerced whatever arrived — `String(id)` turns undefined
   * into the string "undefined", which then reads as a real id and fails much
   * later as an empty result. These reject at the boundary instead, naming the
   * channel and the position, so a renderer bug is reported where it happened.
   */
  const handleArgs = (
    channel: string,
    parsers: ReadonlyArray<ArgParser<unknown>>,
    fn: (...args: never[]) => unknown,
  ) => {
    handle(channel, (...args) => fn(...(parseArgs(channel, parsers, args) as never[])));
  };

  handle(IPC_CHANNELS.listProjects, () => requireEngine().listProjects());
  handle(IPC_CHANNELS.createProject, (input) =>
    requireEngine().createProject(input as Parameters<CapsuleEngine["createProject"]>[0]),
  );
  handle(IPC_CHANNELS.cloneRepository, (input) =>
    requireEngine().cloneRepository(input as Parameters<CapsuleEngine["cloneRepository"]>[0]),
  );
  handleArgs(IPC_CHANNELS.getProject, [id], (projectId: string) =>
    requireEngine().getProject(projectId),
  );
  handle(IPC_CHANNELS.listAgents, () => requireEngine().listAgents());
  // The open project too: a skill checked into it is only reachable when the
  // list knows which project is open.
  handle(IPC_CHANNELS.listSkills, (projectId) =>
    requireEngine().listSkills(projectId ? String(projectId) : undefined),
  );
  handleArgs(IPC_CHANNELS.listSkillFiles, [id, optStr], (skillId: string, relative?: string) =>
    requireEngine().listSkillFiles(skillId, relative),
  );
  handleArgs(IPC_CHANNELS.previewSkillFile, [id, str], (skillId: string, relative: string) =>
    requireEngine().previewSkillFile(skillId, relative),
  );
  handleArgs(IPC_CHANNELS.listSessions, [optStr], (projectId: string | undefined) =>
    requireEngine().listSessions(projectId),
  );
  handle(IPC_CHANNELS.createSession, (input) =>
    requireEngine().createSession(input as Parameters<CapsuleEngine["createSession"]>[0]),
  );
  handle(IPC_CHANNELS.setSessionWorkspaceMode, (sessionId, mode) =>
    requireEngine().setSessionWorkspaceMode(String(sessionId), mode === "worktree" ? "worktree" : "local"),
  );
  handleArgs(IPC_CHANNELS.renameSession, [id, str], (sessionId: string, title: string) =>
    requireEngine().renameSession(sessionId, title),
  );
  handleArgs(IPC_CHANNELS.archiveSession, [id], (sessionId: string) =>
    requireEngine().archiveSession(sessionId),
  );
  handleArgs(IPC_CHANNELS.deleteSession, [id], (sessionId: string) =>
    requireEngine().deleteSession(sessionId),
  );
  handleArgs(IPC_CHANNELS.listMessages, [id], (sessionId: string) =>
    requireEngine().listMessages(sessionId),
  );
  handle(IPC_CHANNELS.listMessagePage, (sessionId, options) =>
    requireEngine().listMessagePage(
      String(sessionId),
      options as { limit?: number; before?: { createdAt: string; id: string; }; } | undefined,
    ),
  );
  handle(IPC_CHANNELS.sendMessage, (input) =>
    requireEngine().sendMessage(input as Parameters<CapsuleEngine["sendMessage"]>[0]),
  );
  handle(IPC_CHANNELS.startRun, (input) =>
    requireEngine().sendMessage(input as Parameters<CapsuleEngine["sendMessage"]>[0]),
  );
  handleArgs(IPC_CHANNELS.stopRun, [id], (runId: string) => requireEngine().stopRun(runId));
  handleArgs(IPC_CHANNELS.getRun, [id], (runId: string) => requireEngine().getRun(runId));
  handleArgs(IPC_CHANNELS.listRuns, [optStr], (sessionId: string | undefined) =>
    requireEngine().listRuns(sessionId),
  );
  handleArgs(IPC_CHANNELS.listRunEvents, [id], (runId: string) =>
    requireEngine().listRunEvents(runId),
  );
  handleArgs(IPC_CHANNELS.verifyRun, [id, optStr], (runId: string, actionId?: string) => requireEngine().verifyRun(runId, actionId));
  handleArgs(IPC_CHANNELS.cancelVerification, [id], (runId: string) => requireEngine().cancelVerification(runId));
  handleArgs(IPC_CHANNELS.listArtifacts, [optStr], (runId: string | undefined) =>
    requireEngine().listArtifacts(runId),
  );
  handle(IPC_CHANNELS.listApprovals, (status) =>
    requireEngine().listApprovals(status as never),
  );
  handle(IPC_CHANNELS.resolveApproval, (id, decision) =>
    requireEngine().resolveApproval(String(id), decision as never),
  );
  handle(IPC_CHANNELS.readFile, (projectId, relative, root) =>
    requireEngine().readFile(
      String(projectId),
      String(relative),
      root ? String(root) : undefined,
    ),
  );
  handle(IPC_CHANNELS.readFileVersioned, (projectId, relative, root) =>
    requireEngine().readFileVersioned(
      String(projectId),
      String(relative),
      8_000,
      root ? String(root) : undefined,
    ),
  );
  handle(IPC_CHANNELS.previewFile, (projectId, relative, root) =>
    requireEngine().previewFile(
      String(projectId),
      String(relative),
      root ? String(root) : undefined,
    ),
  );
  handle(IPC_CHANNELS.writeFile, (projectId, relative, content, options) =>
    requireEngine().writeFile(String(projectId), String(relative), String(content), {
      // Only the renderer's own editor calls this channel, and reaching it
      // required a person typing into the file.
      origin: (options as { origin?: "user" | "agent"; } | undefined)?.origin ?? "user",
      ...(() => {
        const revision = (options as { expectedRevision?: string; } | undefined)?.expectedRevision;
        return revision === undefined ? {} : { expectedRevision: revision };
      })(),
      ...(() => {
        const root = (options as { root?: string; } | undefined)?.root;
        return root ? { root } : {};
      })(),
    }),
  );
  handle(IPC_CHANNELS.listFiles, (projectId, relative, root) =>
    requireEngine().listFiles(
      String(projectId),
      relative ? String(relative) : ".",
      root ? String(root) : undefined,
    ),
  );
  handle(IPC_CHANNELS.openTerminal, (projectId, sessionId) =>
    requireEngine().openTerminal(String(projectId), sessionId ? String(sessionId) : undefined),
  );
  handle(IPC_CHANNELS.terminalStart, (input) => {
    const request = input as { cwd?: string; cols?: number; rows?: number; };
    const cwd = String(request.cwd ?? "");
    const id = `term_${Math.random().toString(36).slice(2, 10)}`;
    const session = startPty(
      { cwd, cols: request.cols, rows: request.rows },
      {
        onData: (data) => send(IPC_EVENTS.terminalData, { id, data }),
        onExit: (code) => {
          terminals.delete(id);
          send(IPC_EVENTS.terminalExit, { id, code });
        },
      },
    );
    terminals.set(id, session);
    return { id, pid: session.pid, cwd };
  });
  handle(IPC_CHANNELS.terminalInput, (id, data) => {
    terminals.get(String(id))?.write(String(data));
    return true;
  });
  handle(IPC_CHANNELS.terminalResize, (id, cols, rows) => {
    terminals.get(String(id))?.resize(Number(cols), Number(rows));
    return true;
  });
  handle(IPC_CHANNELS.terminalStop, (id) => {
    stopTerminal(String(id));
    return true;
  });
  handle(IPC_CHANNELS.execInProject, (projectId, command, sessionId) =>
    requireEngine().execInProject(
      String(projectId),
      String(command),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.runProjectAction, (projectId, actionId, sessionId) =>
    requireEngine().runProjectAction(
      String(projectId),
      String(actionId),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.stopProjectAction, (projectId, actionId, sessionId) =>
    requireEngine().stopProjectAction(
      String(projectId),
      String(actionId),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.listProjectActionRuns, (projectId, sessionId) =>
    requireEngine().listProjectActionRuns(
      String(projectId),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.getStatus, () => requireEngine().getStatus());
  handle(IPC_CHANNELS.getSubsystemStatus, () => requireEngine().getSubsystemStatus());
  handle(IPC_CHANNELS.connectGateway, (url) =>
    requireEngine().connectGateway(url ? String(url) : undefined),
  );
  handle(IPC_CHANNELS.disconnectGateway, () => requireEngine().disconnectGateway());
  handle(IPC_CHANNELS.getSettings, () => requireEngine().getSettings());
  handle(IPC_CHANNELS.updateSettings, async (patch) => {
    const next = await requireEngine().updateSettings(patch as never);
    applyDesktopSettings(next);
    return next;
  });
  handle(IPC_CHANNELS.getDiagnostics, () => requireEngine().getDiagnostics());
  handle(IPC_CHANNELS.search, (query) => requireEngine().search(String(query)));
  handle(IPC_CHANNELS.searchFiles, (projectId, query, root) =>
    requireEngine().searchFiles(
      String(projectId),
      query ? String(query) : "",
      root ? String(root) : undefined,
    ),
  );
  handle(IPC_CHANNELS.pinSession, (id, pinned) =>
    requireEngine().pinSession(String(id), Boolean(pinned)),
  );
  handle(IPC_CHANNELS.reorderPinnedSessions, (projectId, orderedIds) =>
    requireEngine().reorderPinnedSessions(
      String(projectId),
      Array.isArray(orderedIds) ? orderedIds.map(String) : [],
    ),
  );
  handle(IPC_CHANNELS.validateAttachments, (attachments) =>
    withThumbnails(requireEngine().validateAttachments(
      Array.isArray(attachments)
        ? attachments.map((item) => ({
          name: String((item as { name?: unknown; }).name ?? "attachment"),
          path: String((item as { path?: unknown; }).path ?? ""),
          }))
        : [],
    )),
  );
  handle(IPC_CHANNELS.regenerateTitle, (id) => requireEngine().regenerateTitle(String(id)));
  handle(IPC_CHANNELS.setPermissionProfile, (id, profile) =>
    requireEngine().setPermissionProfile(String(id), profile as never),
  );
  handle(IPC_CHANNELS.updateProject, (id, patch) =>
    requireEngine().updateProject(String(id), patch as UpdateProjectInput),
  );
  handle(IPC_CHANNELS.deleteProject, (id) => requireEngine().deleteProject(String(id)));
  handle(IPC_CHANNELS.gitStatus, (projectId, sessionId) =>
    requireEngine().gitStatus(String(projectId), sessionId ? String(sessionId) : undefined),
  );
  handleArgs(IPC_CHANNELS.listPullRequests, [id, optStr, optBool], (projectId: string, sessionId: string | undefined, refresh: boolean) =>
    requireEngine().listPullRequests(projectId, sessionId, refresh),
  );
  handleArgs(IPC_CHANNELS.getCommitDiff, [id, id, optStr], (projectId: string, oid: string, sessionId: string | undefined) =>
    requireEngine().commitDiff(projectId, oid, sessionId),
  );
  handle(IPC_CHANNELS.getPullRequest, (projectId, number, sessionId) =>
    requireEngine().pullRequestDetail(
      String(projectId),
      Number(number),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitInit, (projectId) => requireEngine().gitInit(String(projectId)));
  handle(IPC_CHANNELS.gitDiff, (projectId, relative, sessionId) =>
    requireEngine().gitDiff(
      String(projectId),
      relative ? String(relative) : undefined,
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.checkoutBranch, (projectId, branch, sessionId) =>
    requireEngine().checkoutBranch(
      String(projectId),
      String(branch),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitCommit, (projectId, message, sessionId) =>
    requireEngine().gitCommit(
      String(projectId),
      String(message),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitStage, (projectId, relative, sessionId) =>
    requireEngine().gitStage(
      String(projectId),
      String(relative),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitDiscard, (projectId, relative, sessionId) =>
    requireEngine().gitDiscard(
      String(projectId),
      String(relative),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitCreateBranch, (projectId, branch, sessionId) =>
    requireEngine().gitCreateBranch(
      String(projectId),
      String(branch),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.gitPush, (projectId, sessionId) =>
    requireEngine().gitPush(String(projectId), sessionId ? String(sessionId) : undefined),
  );
  handle(IPC_CHANNELS.gitCreatePullRequest, (projectId, input) =>
    requireEngine().gitCreatePullRequest(
      String(projectId),
      input as { title?: string; body?: string; sessionId?: string; } | undefined,
    ),
  );
  handle(IPC_CHANNELS.gitMergePullRequest, (projectId, sessionId) =>
    requireEngine().gitMergePullRequest(
      String(projectId),
      sessionId ? String(sessionId) : undefined,
    ),
  );
  handle(IPC_CHANNELS.searchContents, (projectId, query) =>
    requireEngine().searchContents(String(projectId), String(query)),
  );
  handle(IPC_CHANNELS.listLocalServers, () => requireEngine().localServers());
  handle(IPC_CHANNELS.openPath, async (target) => {
    const location = String(target);
    if (!location) return;
    if (/^https?:\/\//i.test(location)) {
      await shell.openExternal(location);
      return;
    }
    await shell.openPath(location);
  });
  handle(IPC_CHANNELS.pickDirectory, async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Open folder",
      message: "Choose the code folder Capsule should work in",
      buttonLabel: "Open",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });
  handle(IPC_CHANNELS.pickFiles, async () => {
    const win = mainWindow ?? BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Open files",
      buttonLabel: "Open",
      properties: ["openFile", "multiSelections"],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  /*
   * A screenshot on the clipboard, written to a file the agent can open.
   *
   * Pasting an image did nothing at all: the composer only ever accepted
   * filesystem paths, which is why dropping a file worked and pasting a
   * screenshot did not — clipboard image data has no path to hand over. This
   * reads the bitmap the OS is holding and gives it one.
   *
   * Stored under userData rather than a temp directory, because an attachment
   * has to still be there when the turn runs, and a prompt can be stashed and
   * picked up days later.
   */
  /*
   * Which WebContents the browser pane is showing.
   *
   * A <webview> is a guest the main process can reach by id, so the agent's
   * browser tools run here rather than hopping through the renderer. The
   * renderer only has to say which id it owns, and say so again as undefined
   * when the pane closes — a stale id would let a tool drive a page nobody is
   * looking at.
   */
  handle(IPC_CHANNELS.registerBrowserView, (webContentsId) => {
    browserViewId = typeof webContentsId === "number" ? webContentsId : undefined;
    return true;
  });
  handle(IPC_CHANNELS.saveClipboardImage, async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return undefined;
    const dir = path.join(app.getPath("userData"), "attachments");
    await fsp.mkdir(dir, { recursive: true });
    // Seconds are not enough: two screenshots pasted in the same second would
    // otherwise land on the same name and the first would be lost.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `Pasted image ${stamp}.png`);
    await fsp.writeFile(file, image.toPNG());
    return file;
  });
  handle(IPC_CHANNELS.listHarnesses, () => requireEngine().listHarnesses());
  handle(IPC_CHANNELS.doctorHarness, (harnessId) =>
    requireEngine().doctorHarness(harnessId as HarnessId),
  );
  handle(IPC_CHANNELS.dedicateHarness, (projectId, harnessId) =>
    requireEngine().dedicateHarness(String(projectId), harnessId as HarnessId),
  );
  handle(IPC_CHANNELS.undedicateHarness, (projectId) =>
    requireEngine().undedicateHarness(String(projectId)),
  );
  handle(IPC_CHANNELS.spawnHarness, (input) =>
    requireEngine().spawnHarness(input as SpawnHarnessInput),
  );
  handle(IPC_CHANNELS.cancelHarness, (sessionId) =>
    requireEngine().cancelHarness(String(sessionId)),
  );
  handle(IPC_CHANNELS.steerHarness, (sessionId, instruction) =>
    requireEngine().steerHarness(String(sessionId), String(instruction)),
  );
  handle(IPC_CHANNELS.closeHarness, (sessionId) =>
    requireEngine().closeHarness(String(sessionId)),
  );
  handle(IPC_CHANNELS.harnessStatus, (sessionId) =>
    requireEngine().harnessStatus(String(sessionId)),
  );
  handle(IPC_CHANNELS.setHarnessOption, (patch) =>
    requireEngine().setHarnessOption(patch as HarnessOptionPatch),
  );
  handle(IPC_CHANNELS.listHarnessSessions, (projectId) =>
    requireEngine().listHarnessSessions(projectId ? String(projectId) : undefined),
  );
  handle(IPC_CHANNELS.listSkillPacks, () => requireEngine().listSkillPacks());
  handle(IPC_CHANNELS.installSkill, (skill) =>
    requireEngine().installSkill(skill as Parameters<CapsuleEngine["installSkill"]>[0]),
  );
  handle(IPC_CHANNELS.installSkillPack, (packId) =>
    requireEngine().installSkillPack(String(packId)),
  );
  handle(IPC_CHANNELS.uninstallSkill, (skillId) =>
    requireEngine().uninstallSkill(String(skillId)),
  );
  handleArgs(IPC_CHANNELS.resetSettingsSection, [id], (section: string) =>
    requireEngine().resetSettingsSection(section),
  );
  /*
   * Both routes, one answer. The updater knows whether this build can replace
   * itself; the GitHub check knows what the latest release is even when that
   * release shipped no update feed, which every one before 0.3.0 did.
   */
  handle(IPC_CHANNELS.checkForUpdates, async () => {
    const fallback = await checkForUpdates();
    if (!app.isPackaged) return fallback;
    const status = await ensureUpdater().check();
    return mergeUpdateStatus(status, fallback);
  });
  /*
   * What is already known, for the renderer that just heard the status change.
   *
   * It used to answer that event by running the full check again — a GitHub
   * request and a fresh autoUpdater check, per event. Progress events arrive
   * many times a second, so downloading an update meant hundreds of calls to
   * an API that allows sixty an hour, and each one reset the download it was
   * reporting on. This reads the state and nothing else.
   */
  handle(IPC_CHANNELS.updateStatus, () =>
    app.isPackaged
      ? mergeUpdateStatus(ensureUpdater().current(), lastUpdateCheck)
      : (lastUpdateCheck ?? { state: "up-to-date", current: app.getVersion() }),
  );
  handle(IPC_CHANNELS.downloadUpdate, async () => {
    const status = await ensureUpdater().download();
    return mergeUpdateStatus(status, undefined);
  });
  handle(IPC_CHANNELS.installUpdate, () => ensureUpdater().install());
  /*
   * Electron's own accounting for this app's process tree. It costs nothing to
   * collect and needs no native code — which is also its limit: per-process
   * disk throughput and a host-wide process scan are not exposed here, so they
   * are absent rather than guessed at.
   */
  /*
   * Host conditions, all from Electron's powerMonitor. Worth reporting next to
   * the process table because they explain it: a machine on battery in a
   * serious thermal state is throttling, and a slow agent turn is the symptom
   * rather than the cause.
   */
  handle(IPC_CHANNELS.sourceControlTools, () => requireEngine().sourceControlTools());
  handle(IPC_CHANNELS.hostState, () => {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    return {
      onBattery: powerMonitor.isOnBatteryPower(),
      // 60s is the threshold for "idle"; below it the user is still here.
      idleState: powerMonitor.getSystemIdleState(60),
      idleSeconds,
      thermalState: powerMonitor.getCurrentThermalState(),
    };
  });

  handle(IPC_CHANNELS.processMetrics, () => latestSample ?? sampleResources());
  handle(IPC_CHANNELS.processHistory, () => [...resourceHistory]);
  // The renderer has painted the app, not just an empty document.
  handle(IPC_CHANNELS.windowBackground, (color) => {
    if (!isHexColor(color)) return false;
    if (paintedBackground === color) return true;
    paintedBackground = color;
    if (mainWindow && !mainWindow.isDestroyed()) {
      // The frame behind the app while it is resized or restored.
      mainWindow.setBackgroundColor(color);
      saveWindowState(mainWindow);
    }
    return true;
  });
  handle(IPC_CHANNELS.remoteStatus, () => ({
    reach: remoteReach,
    ...(remote ? { url: remote.url } : {}),
    ...(remotePairingUrl ? { pairingUrl: remotePairingUrl } : {}),
    ...(remoteError ? { error: remoteError } : {}),
    devices: (remote?.sessions() ?? []).map((session) => ({
      id: session.id,
      label: session.label,
      scopes: session.scopes,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
    })),
  }));
  handle(IPC_CHANNELS.remotePair, () => {
    if (!remote) throw new Error("Turn on reading from another device first.");
    // Read only. Nothing in this build hands out a scope that can send a
    // prompt or run a command from another device.
    remotePairingUrl = remote.pair(["read"]);
    send(IPC_EVENTS.state, { command: "remote-updated" });
    return remotePairingUrl;
  });
  handle(IPC_CHANNELS.remoteRevoke, (id) => {
    remote?.revoke(String(id));
    return true;
  });
  handle(IPC_CHANNELS.rendererReady, () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) mainWindow.show();
    return true;
  });
  handleArgs(IPC_CHANNELS.usageSummary, [num], (days: number) =>
    requireEngine().usageSummary(days),
  );
  handleArgs(IPC_CHANNELS.turnDiff, [id], (runId: string) => requireEngine().turnDiff(runId));
  handleArgs(IPC_CHANNELS.restoreTurn, [id], (runId: string) =>
    requireEngine().restoreTurn(runId),
  );
  handleArgs(IPC_CHANNELS.searchSkillCatalog, [str, optBool], (query: string, refresh: boolean) =>
    requireEngine().searchSkillCatalog(query, refresh),
  );
  handleArgs(IPC_CHANNELS.fetchSkillDetail, [id], (skillId: string) =>
    requireEngine().fetchSkillDetail(skillId),
  );

  ipcMain.handle(IPC_CHANNELS.showContextMenu, async (event, payload: PopupMenuRequest) => {
    try {
      return await popupContextMenu(event, payload);
    } catch (error) {
      console.error(`IPC ${IPC_CHANNELS.showContextMenu} failed`, error);
      throw error;
    }
  });
}

function bindEngineEvents(): void {
  if (!engine) return;
  engine.events.on("connection", (status) => send(IPC_EVENTS.connection, status));
  engine.events.on("run", (run: Run) => {
    send(IPC_EVENTS.run, run);
    notifyRunSettled(run);
    applyKeepAwake(engine?.getSettings());
    refreshTrayAttention();
  });
  engine.events.on("run-event", (event) => send(IPC_EVENTS.run, event));
  engine.events.on("message", (message) => send(IPC_EVENTS.message, message));
  engine.events.on("state", (payload) => send(IPC_EVENTS.state, payload));
  engine.events.on("approval", (approval: ApprovalRequest) => {
    send(IPC_EVENTS.approval, approval);
    if (approval.status === "pending") notifyApproval(approval);
    refreshTrayAttention();
  });
}

function applyNativeTheme(theme: "system" | "dark" | "light" | undefined): void {
  nativeTheme.themeSource = theme === "light" || theme === "dark" ? theme : "system";
}

function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    console.warn("Launch at login failed", error);
  }
}

function createMenu(): void {
  const openSettings = () => send(IPC_EVENTS.state, { command: "settings" });
  const openAbout = () => send(IPC_EVENTS.state, { command: "about" });
  const mac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: "About Capsule",
                click: openAbout,
              },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "CommandOrControl+,",
                click: openSettings,
              },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Task",
          accelerator: "CommandOrControl+N",
          click: () => send(IPC_EVENTS.state, { command: "new-task" }),
        },
        {
          label: "Open Folder…",
          accelerator: "CommandOrControl+O",
          click: () => send(IPC_EVENTS.state, { command: "open-folder" }),
        },
        {
          label: "Open Files…",
          accelerator: "CommandOrControl+Shift+O",
          click: () => send(IPC_EVENTS.state, { command: "open-files" }),
        },
        {
          label: "New Project from Folder…",
          accelerator: "CommandOrControl+Shift+N",
          click: () => send(IPC_EVENTS.state, { command: "new-project" }),
        },
        ...(!mac
          ? [
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "CommandOrControl+,",
                click: openSettings,
              },
            ]
          : []),
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Command Palette",
          accelerator: "CommandOrControl+K",
          click: () => send(IPC_EVENTS.state, { command: "palette" }),
        },
        {
          label: "Skills & Packs",
          accelerator: "CommandOrControl+Shift+S",
          click: () => send(IPC_EVENTS.state, { command: "skills" }),
        },
        {
          label: "Runtimes",
          accelerator: "CommandOrControl+Shift+R",
          click: () => send(IPC_EVENTS.state, { command: "harness" }),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "About Capsule",
          click: openAbout,
        },
        {
          label: "Explore skills.sh",
          click: () => void shell.openExternal("https://skills.sh"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  if (tray) return;
  try {
    const image =
      loadIcon("trayTemplate@2x.png") ??
      loadIcon("trayTemplate.png") ??
      loadIcon("icon.png") ??
      nativeImage.createEmpty();
    if (process.platform === "darwin" && !image.isEmpty()) {
      image.setTemplateImage(true);
    }
    tray = new Tray(image);
    tray.setToolTip("Capsule");
    buildTrayMenu();
  } catch (error) {
    console.warn("Menu bar extra failed", error);
  }
}

/*
 * The menu bar extra, as a place to find the thread that wants you.
 *
 * It held a fixed list of destinations and never changed, so with a dozen
 * threads running there was no way to tell which one had stopped for a
 * decision without opening them. The threads waiting on a person go at the
 * top, most urgent first, and clicking one opens it.
 */
const ATTENTION_MARK: Record<AttentionState, string> = {
  "needs-input": "●",
  blocked: "✕",
  ready: "✓",
  running: "○",
};

function attentionEntries(): Electron.MenuItemConstructorOptions[] {
  if (!engine) return [];
  try {
    const summary = summariseAttention({
      sessions: engine.listSessions(),
      runs: engine.listRuns(),
    });
    if (summary.items.length === 0) return [];
    // A menu is not a dashboard; the tail is reachable in the window.
    const shown = summary.items.slice(0, 8);
    return [
      { label: attentionLabel(summary) ?? "Waiting", enabled: false },
      ...shown.map((item) => ({
        label: `${ATTENTION_MARK[item.state]}  ${item.title}`,
        click: () => {
          mainWindow?.show();
          send(IPC_EVENTS.state, { command: "open-session", sessionId: item.sessionId });
        },
      })),
      { type: "separator" as const },
    ];
  } catch {
    // The menu must open whatever the engine is doing.
    return [];
  }
}

function buildTrayMenu(): void {
  if (!tray) return;
  try {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        ...attentionEntries(),
        { label: "Open Capsule", click: () => mainWindow?.show() },
        { label: "About Capsule", click: () => send(IPC_EVENTS.state, { command: "about" }) },
        { label: "Settings…", click: () => send(IPC_EVENTS.state, { command: "settings" }) },
        { label: "Skills & Packs", click: () => send(IPC_EVENTS.state, { command: "skills" }) },
        { label: "Approvals", click: () => send(IPC_EVENTS.state, { command: "approvals" }) },
        { label: "Active runs", click: () => send(IPC_EVENTS.state, { command: "runs" }) },
        { type: "separator" },
        { label: "Quit", click: () => app.quit() },
      ]),
    );
  } catch (error) {
    console.warn("Menu bar menu failed", error);
  }
}

/*
 * Rebuild on every run and approval. A menu bar extra that is right only when
 * it was last opened is worse than one that says nothing.
 */
function refreshTrayAttention(): void {
  if (!tray || !engine) return;
  buildTrayMenu();
  try {
    const summary = summariseAttention({ sessions: engine.listSessions(), runs: engine.listRuns() });
    const label = attentionLabel(summary);
    tray.setToolTip(label ? `Capsule — ${label}` : "Capsule");
    /*
     * A count in the menu bar only when someone is actually needed. "Running"
     * is the app doing its job, and a number that is always there stops being
     * read.
     */
    const waiting = summary.counts["needs-input"] + summary.counts.blocked;
    if (process.platform === "darwin") tray.setTitle(waiting > 0 ? ` ${waiting}` : "");
  } catch {
    // Never let the menu bar take the app down.
  }
}

async function startEngine(): Promise<void> {
  engineStarted = startEngineOnce();
  await engineStarted;
}

async function startEngineOnce(): Promise<void> {
  await ensureSqliteAbi();
  const { CapsuleEngine } = await import("@capsule/core");
  engine = new CapsuleEngine({
    databasePath: path.join(userDataDir(), "capsule.sqlite"),
    userDataDir: userDataDir(),
    capsuleVersion: app.getVersion(),
    clientVersion: app.getVersion(),
    // The Gateway operator token and the skills.sh token; the settings screen
    // calls this the Keychain and now it is one.
    secretEncryptor: {
      isAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (value) => safeStorage.encryptString(value),
      decryptString: (value) => safeStorage.decryptString(value),
    },
  });
  await engine.start();
  /*
   * The browser tools, offered to agents Capsule spawns itself.
   *
   * Started after the engine so its URL exists before any agent is told about
   * it, and best effort: a port that will not bind is a browser the agent
   * cannot use, not a Capsule that will not open.
   */
  try {
    browserMcp = await startBrowserMcpServer(browserTarget);
    engine.offerDirectMcpServers([
      {
        type: "http",
        name: "capsule-browser",
        url: browserMcp.url,
        headers: Object.entries(browserMcp.headers).map(([name, value]) => ({ name, value })),
      },
    ]);
  } catch (error) {
    console.warn("Browser tools unavailable:", error instanceof Error ? error.message : error);
  }
  bindEngineEvents();
  applyDesktopSettings(engine.getSettings());
  send(IPC_EVENTS.connection, await engine.getStatus());
}


/*
 * `capsule://` links.
 *
 * A link is how another app hands work over: a pairing page, a note, a
 * terminal. Only routes the app already has are honoured — a link cannot ask
 * for anything the menu cannot — and an unknown one just brings the window
 * forward rather than failing silently.
 */
const APP_SCHEME = "capsule";

function revealWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function handleDeepLink(raw: string): void {
  revealWindow();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return;
  }
  if (parsed.protocol !== `${APP_SCHEME}:`) return;
  // `capsule://settings`, `capsule://skills`, and so on: the same commands the
  // menu sends, named the same way.
  const route = (parsed.hostname || parsed.pathname.replace(/^\/+/, "")).toLowerCase();
  const allowed = ["settings", "skills", "approvals", "runs", "harness", "palette", "about"];
  if (allowed.includes(route)) send(IPC_EVENTS.state, { command: route });
}

/*
 * One Capsule per profile.
 *
 * Two instances open the same SQLite file, keep their own idea of which agent
 * sessions are live, both watch the same pull requests, and both try to bind
 * the remote-access port. Nothing stopped it: a second launch simply started
 * and neither said a word. The second instance now hands its argv to the first
 * and quits.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    revealWindow();
    const url = argv.find((arg) => arg.startsWith(`${APP_SCHEME}://`));
    if (url) handleDeepLink(url);
  });
}

// macOS delivers a link through open-url, which can fire before the app is
// ready; the window is created on demand, so it does not need to wait.
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.whenReady().then(async () => {
  app.setName("Capsule");
  app.setAsDefaultProtocolClient(APP_SCHEME);
  augmentPath();
  applyDockIcon();
  registerIpc();
  // Started before the window so the renderer's first calls have a promise to
  // wait on, and awaited after so the window still appears while it opens.
  const starting = startEngine();
  startResourceSampling();
  createMenu();
  createTray();
  mainWindow = createWindow();
  try {
    await starting;
  } catch (error) {
    console.error("Capsule engine failed to start", error);
  }
  await announceRemoteAccess();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });

  /*
   * A socket does not survive a closed lid. Nothing reconnected it, so the
   * Gateway stayed dead after every sleep until someone noticed the offline
   * banner and pressed Connect. Reconnect on wake, and only when it was
   * connected before — an app deliberately left offline stays offline.
   */
  powerMonitor.on("resume", () => {
    void (async () => {
      try {
        const status = await engine?.getStatus();
        if (!status || status.state === "connected") return;
        if (!engine?.getSettings().gatewayUrl) return;
        await engine.connectGateway();
        send(IPC_EVENTS.connection, await engine.getStatus());
      } catch {
        // Still asleep, still offline, or the Gateway is gone. The banner
        // already says so and a manual Connect still works.
      }
    })();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/*
 * Quitting stops every running agent, and ⌘Q is one key away from ⌘W. Ask
 * first, but only when there is something to lose: a confirmation on an idle
 * app is a dialog that teaches people to dismiss dialogs.
 */
let quitConfirmed = false;

app.on("before-quit", (event) => {
  const running = engine?.listRuns().filter((run) =>
    ["running", "queued", "waiting", "approval_required"].includes(run.status),
  ).length ?? 0;
  if (running > 0 && !quitConfirmed && mainWindow && !mainWindow.isDestroyed()) {
    event.preventDefault();
    revealWindow();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: "question",
      buttons: ["Quit anyway", "Keep working"],
      defaultId: 1,
      cancelId: 1,
      message: running === 1 ? "A turn is still running." : `${running} turns are still running.`,
      detail: "Quitting stops the agent where it is. Anything it has already written stays.",
    });
    if (choice !== 0) return;
    quitConfirmed = true;
    app.quit();
    return;
  }
  applyKeepAwake(undefined);
  if (sampleTimer) clearInterval(sampleTimer);
  stopAllTerminals();
  void engine?.stop();
});
