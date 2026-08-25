import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  shell,
} from "electron";
import type { CapsuleEngine } from "@capsule/core";
import { IPC_CHANNELS, IPC_EVENTS, type ApprovalRequest } from "@capsule/shared";
import { ensureSqliteAbi } from "./sqlite-abi";

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let engine: CapsuleEngine | undefined;

function userDataDir(): string {
  const dir = path.join(app.getPath("userData"), "state");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "Capsule",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#24273a",
    show: false,
    webPreferences: {
      preload: existsSync(path.join(__dirname, "../preload/index.mjs"))
        ? path.join(__dirname, "../preload/index.mjs")
        : path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return window;
}

function send(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function notifyApproval(approval: ApprovalRequest): void {
  if (!Notification.isSupported()) return;
  new Notification({
    title: "Approval required",
    body: `${approval.agentName} wants to ${approval.action} ${approval.target}`,
  }).show();
}

function registerIpc(): void {
  const requireEngine = () => {
    if (!engine) throw new Error("Capsule engine is not ready");
    return engine;
  };

  const handle = (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...args));
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
  handle(IPC_CHANNELS.readFile, (projectId, relative) =>
    requireEngine().readFile(String(projectId), String(relative)),
  );
  handle(IPC_CHANNELS.writeFile, (projectId, relative, content) =>
    requireEngine().writeFile(String(projectId), String(relative), String(content)),
  );
  handle(IPC_CHANNELS.listFiles, (projectId, relative) =>
    requireEngine().listFiles(String(projectId), relative ? String(relative) : "."),
  );
  handle(IPC_CHANNELS.openTerminal, (projectId) => requireEngine().openTerminal(String(projectId)));
  handle(IPC_CHANNELS.getStatus, () => requireEngine().getStatus());
  handle(IPC_CHANNELS.getSubsystemStatus, () => requireEngine().getSubsystemStatus());
  handle(IPC_CHANNELS.connectGateway, (url) =>
    requireEngine().connectGateway(url ? String(url) : undefined),
  );
  handle(IPC_CHANNELS.disconnectGateway, () => requireEngine().disconnectGateway());
  handle(IPC_CHANNELS.getSettings, () => requireEngine().getSettings());
  handle(IPC_CHANNELS.updateSettings, (patch) => requireEngine().updateSettings(patch as never));
  handle(IPC_CHANNELS.getDiagnostics, () => requireEngine().getDiagnostics());
  handle(IPC_CHANNELS.search, (query) => requireEngine().search(String(query)));
  handle(IPC_CHANNELS.listHarnesses, () => requireEngine().listHarnesses());
  handle(IPC_CHANNELS.dedicateHarness, (projectId, harnessId) =>
    requireEngine().dedicateHarness(String(projectId), harnessId as never),
  );
  handle(IPC_CHANNELS.spawnHarness, (projectId, harnessId, prompt) =>
    requireEngine().spawnHarness(
      String(projectId),
      harnessId as never,
      prompt ? String(prompt) : undefined,
    ),
  );
}

function bindEngineEvents(): void {
  if (!engine) return;
  engine.events.on("connection", (status) => send(IPC_EVENTS.connection, status));
  engine.events.on("run", (run) => send(IPC_EVENTS.run, run));
  engine.events.on("run-event", (event) => send(IPC_EVENTS.run, event));
  engine.events.on("message", (message) => send(IPC_EVENTS.message, message));
  engine.events.on("approval", (approval: ApprovalRequest) => {
    send(IPC_EVENTS.approval, approval);
    if (approval.status === "pending") notifyApproval(approval);
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Task",
          accelerator: "CommandOrControl+N",
          click: () => send(IPC_EVENTS.state, { command: "new-task" }),
        },
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
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  const image = nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setTitle("Capsule");
  tray.setToolTip("Capsule");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Capsule", click: () => mainWindow?.show() },
      { label: "Approvals", click: () => send(IPC_EVENTS.state, { command: "approvals" }) },
      { label: "Active runs", click: () => send(IPC_EVENTS.state, { command: "runs" }) },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() },
    ]),
  );
}

app.whenReady().then(async () => {
  try {
    await ensureSqliteAbi();
    const { CapsuleEngine } = await import("@capsule/core");
    engine = new CapsuleEngine({
      databasePath: path.join(userDataDir(), "capsule.sqlite"),
      userDataDir: userDataDir(),
      capsuleVersion: app.getVersion(),
      clientVersion: app.getVersion(),
    });
    await engine.start();
  } catch (error) {
    console.error("Capsule engine failed to start", error);
  }
  registerIpc();
  bindEngineEvents();
  createMenu();
  createTray();
  mainWindow = createWindow();

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
  void engine?.stop();
});
