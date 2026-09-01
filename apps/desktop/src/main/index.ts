import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  nativeTheme,
  powerSaveBlocker,
  shell,
} from "electron";
import type { CapsuleEngine } from "@capsule/core";
import {
  IPC_CHANNELS,
  IPC_EVENTS,
  type ApprovalRequest,
  type CapsuleSettings,
  type HarnessId,
  type HarnessOptionPatch,
  type PopupMenuRequest,
  type Run,
  type SpawnHarnessInput,
  type UpdateProjectInput,
} from "@capsule/shared";
import { popupContextMenu } from "./popup-menu";
import { ensureSqliteAbi } from "./sqlite-abi";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let engine: CapsuleEngine | undefined;
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
  const current = process.env.PATH ?? "";
  process.env.PATH = [...extras, current].join(path.delimiter);
}

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

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Capsule",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#0a0a0a",
    show: true,
    icon: loadIcon("icon.png"),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
  return window;
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
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
}

function registerIpc(): void {
  const requireEngine = () => {
    if (!engine) throw new Error("Capsule engine is not ready");
    return engine;
  };

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        console.error(`IPC ${channel} failed`, error);
        throw error;
      }
    });
  };

  handle(IPC_CHANNELS.listProjects, () => requireEngine().listProjects());
  handle(IPC_CHANNELS.createProject, (input) =>
    requireEngine().createProject(input as Parameters<CapsuleEngine["createProject"]>[0]),
  );
  handle(IPC_CHANNELS.getProject, (id) => requireEngine().getProject(String(id)));
  handle(IPC_CHANNELS.listAgents, () => requireEngine().listAgents());
  handle(IPC_CHANNELS.listSkills, () => requireEngine().listSkills());
  handle(IPC_CHANNELS.listSessions, (projectId) =>
    requireEngine().listSessions(projectId ? String(projectId) : undefined),
  );
  handle(IPC_CHANNELS.createSession, (input) =>
    requireEngine().createSession(input as Parameters<CapsuleEngine["createSession"]>[0]),
  );
  handle(IPC_CHANNELS.renameSession, (id, title) =>
    requireEngine().renameSession(String(id), String(title)),
  );
  handle(IPC_CHANNELS.archiveSession, (id) => requireEngine().archiveSession(String(id)));
  handle(IPC_CHANNELS.deleteSession, (id) => requireEngine().deleteSession(String(id)));
  handle(IPC_CHANNELS.listMessages, (sessionId) => requireEngine().listMessages(String(sessionId)));
  handle(IPC_CHANNELS.listMessagePage, (sessionId, options) =>
    requireEngine().listMessagePage(
      String(sessionId),
      options as { limit?: number; before?: { createdAt: string; id: string } } | undefined,
    ),
  );
  handle(IPC_CHANNELS.sendMessage, (input) =>
    requireEngine().sendMessage(input as Parameters<CapsuleEngine["sendMessage"]>[0]),
  );
  handle(IPC_CHANNELS.startRun, (input) =>
    requireEngine().sendMessage(input as Parameters<CapsuleEngine["sendMessage"]>[0]),
  );
  handle(IPC_CHANNELS.stopRun, (id) => requireEngine().stopRun(String(id)));
  handle(IPC_CHANNELS.getRun, (id) => requireEngine().getRun(String(id)));
  handle(IPC_CHANNELS.listRuns, (sessionId) =>
    requireEngine().listRuns(sessionId ? String(sessionId) : undefined),
  );
  handle(IPC_CHANNELS.listRunEvents, (runId) => requireEngine().listRunEvents(String(runId)));
  handle(IPC_CHANNELS.verifyRun, (runId) => requireEngine().verifyRun(String(runId)));
  handle(IPC_CHANNELS.listArtifacts, (runId) =>
    requireEngine().listArtifacts(runId ? String(runId) : undefined),
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
      origin: (options as { origin?: "user" | "agent" } | undefined)?.origin ?? "user",
      ...(() => {
        const revision = (options as { expectedRevision?: string } | undefined)?.expectedRevision;
        return revision === undefined ? {} : { expectedRevision: revision };
      })(),
      ...(() => {
        const root = (options as { root?: string } | undefined)?.root;
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
  handle(IPC_CHANNELS.openTerminal, (projectId) => requireEngine().openTerminal(String(projectId)));
  handle(IPC_CHANNELS.execInProject, (projectId, command) =>
    requireEngine().execInProject(String(projectId), String(command)),
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
  handle(IPC_CHANNELS.regenerateTitle, (id) => requireEngine().regenerateTitle(String(id)));
  handle(IPC_CHANNELS.setPermissionProfile, (id, profile) =>
    requireEngine().setPermissionProfile(String(id), profile as never),
  );
  handle(IPC_CHANNELS.updateProject, (id, patch) =>
    requireEngine().updateProject(String(id), patch as UpdateProjectInput),
  );
  handle(IPC_CHANNELS.deleteProject, (id) => requireEngine().deleteProject(String(id)));
  handle(IPC_CHANNELS.gitStatus, (projectId) => requireEngine().gitStatus(String(projectId)));
  handle(IPC_CHANNELS.gitDiff, (projectId, relative) =>
    requireEngine().gitDiff(String(projectId), relative ? String(relative) : undefined),
  );
  handle(IPC_CHANNELS.checkoutBranch, (projectId, branch) =>
    requireEngine().checkoutBranch(String(projectId), String(branch)),
  );
  handle(IPC_CHANNELS.gitCommit, (projectId, message) =>
    requireEngine().gitCommit(String(projectId), String(message)),
  );
  handle(IPC_CHANNELS.gitStage, (projectId, relative) =>
    requireEngine().gitStage(String(projectId), String(relative)),
  );
  handle(IPC_CHANNELS.gitDiscard, (projectId, relative) =>
    requireEngine().gitDiscard(String(projectId), String(relative)),
  );
  handle(IPC_CHANNELS.gitCreateBranch, (projectId, branch) =>
    requireEngine().gitCreateBranch(String(projectId), String(branch)),
  );
  handle(IPC_CHANNELS.gitPush, (projectId) => requireEngine().gitPush(String(projectId)));
  handle(IPC_CHANNELS.gitCreatePullRequest, (projectId, input) =>
    requireEngine().gitCreatePullRequest(
      String(projectId),
      input as { title?: string; body?: string; sessionId?: string } | undefined,
    ),
  );
  handle(IPC_CHANNELS.gitMergePullRequest, (projectId) =>
    requireEngine().gitMergePullRequest(String(projectId)),
  );
  handle(IPC_CHANNELS.searchContents, (projectId, query) =>
    requireEngine().searchContents(String(projectId), String(query)),
  );
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
  handle(IPC_CHANNELS.resetSettingsSection, (section) =>
    requireEngine().resetSettingsSection(String(section)),
  );
  handle(IPC_CHANNELS.turnDiff, (runId) => requireEngine().turnDiff(String(runId)));
  handle(IPC_CHANNELS.restoreTurn, (runId) => requireEngine().restoreTurn(String(runId)));
  handle(IPC_CHANNELS.searchSkillCatalog, (query, refresh) =>
    requireEngine().searchSkillCatalog(String(query), Boolean(refresh)),
  );
  handle(IPC_CHANNELS.fetchSkillDetail, (id) =>
    requireEngine().fetchSkillDetail(String(id)),
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
  });
  engine.events.on("run-event", (event) => send(IPC_EVENTS.run, event));
  engine.events.on("message", (message) => send(IPC_EVENTS.message, message));
  engine.events.on("state", (payload) => send(IPC_EVENTS.state, payload));
  engine.events.on("approval", (approval: ApprovalRequest) => {
    send(IPC_EVENTS.approval, approval);
    if (approval.status === "pending") notifyApproval(approval);
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
    tray.setContextMenu(
      Menu.buildFromTemplate([
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
    console.warn("Menu bar extra failed", error);
  }
}

async function startEngine(): Promise<void> {
  await ensureSqliteAbi();
  const { CapsuleEngine } = await import("@capsule/core");
  engine = new CapsuleEngine({
    databasePath: path.join(userDataDir(), "capsule.sqlite"),
    userDataDir: userDataDir(),
    capsuleVersion: app.getVersion(),
    clientVersion: app.getVersion(),
  });
  await engine.start();
  bindEngineEvents();
  applyDesktopSettings(engine.getSettings());
  send(IPC_EVENTS.connection, await engine.getStatus());
}

app.whenReady().then(async () => {
  app.setName("Capsule");
  augmentPath();
  applyDockIcon();
  registerIpc();
  createMenu();
  createTray();
  mainWindow = createWindow();
  try {
    await startEngine();
  } catch (error) {
    console.error("Capsule engine failed to start", error);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  applyKeepAwake(undefined);
  void engine?.stop();
});
