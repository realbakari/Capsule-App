import { execFile, spawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow, dialog, shell } from "electron";
import {
  mergeOpenInApps,
  OPEN_IN_DEFAULT_APP,
  type CapsuleSettings,
  type OpenInApp,
  type OpenInCatalog,
} from "@capsule/shared";

const run = promisify(execFile);

/*
 * LaunchServices' own answer to "which apps can open this", with each app's
 * display name and icon, through the scripting bridge that ships with macOS,
 * so no native module is needed. argv[0] is the target; the rest are added
 * apps. Electron's getFileIcon gives every bundle the same generic icon.
 */
const LAUNCH_SERVICES_SCRIPT = `function run(argv) {
  ObjC.import("AppKit");
  const workspace = $.NSWorkspace.sharedWorkspace;
  const files = $.NSFileManager.defaultManager;
  const icon = (p) => {
    const size = 64;
    const bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, size, size, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    $.NSGraphicsContext.saveGraphicsState;
    $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));
    workspace.iconForFile(p).drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, size, size), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
    $.NSGraphicsContext.restoreGraphicsState;
    return "data:image/png;base64," + bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).base64EncodedStringWithOptions(0).js;
  };
  const described = (p) => ({ id: p, name: files.displayNameAtPath(p).js, icon: icon(p) });
  const target = $.NSURL.fileURLWithPath(argv[0]);
  const urls = workspace.URLsForApplicationsToOpenURL(target);
  const paths = [];
  for (let i = 0; i < urls.count; i++) paths.push(urls.objectAtIndex(i).path.js);
  // Many apps claim folders (archivers, readers, chat apps). For a folder, keep
  // the ones that also open source code, which is what a project is opened
  // in, plus the system's own folder handler.
  let keep = paths;
  if (target.hasDirectoryPath) {
    const code = new Set();
    // LaunchServices answers for a real file, so write empty probes once.
    for (const probe of ["capsule-open-in-probe.c", "capsule-open-in-probe.py"]) {
      const file = $.NSTemporaryDirectory().js + probe;
      if (!files.fileExistsAtPath(file)) $("").writeToFileAtomicallyEncodingError(file, true, 4, null);
      const editors = workspace.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(file));
      for (let i = 0; i < editors.count; i++) code.add(editors.objectAtIndex(i).path.js);
    }
    const fallback = workspace.URLForApplicationToOpenURL(target);
    const system = fallback.isNil() ? "" : fallback.path.js;
    if (code.size > 0) keep = paths.filter((p) => p === system || code.has(p));
  }
  const handlers = keep.map(described);
  return JSON.stringify({ handlers, added: argv.slice(1).map(described) });
}`;

type Named = Omit<OpenInApp, "added">;
const LIST_TTL_MS = 60_000;
const lists = new Map<string, { at: number; value: Promise<{ handlers: Named[]; added: Named[] }> }>();
const icons = new Map<string, Promise<string | undefined>>();

/** Capsule's own bundle, which LaunchServices may list for a folder. */
function ownBundle(): string | undefined {
  const marker = process.execPath.indexOf(".app/");
  return marker === -1 ? undefined : process.execPath.slice(0, marker + 4);
}

function plainName(location: string): string {
  return path.basename(location).replace(/\.(app|exe)$/i, "");
}

/** The handlers depend on the kind of target, not the path, so a folder and each file type are cached once. */
function listKey(target: string, added: readonly string[]): string {
  let kind = "folder";
  try { if (!statSync(target).isDirectory()) kind = path.extname(target).toLowerCase() || "file"; } catch { /* Listed as a folder. */ }
  return `${kind}\0${added.join("\0")}`;
}

async function systemList(target: string, added: readonly string[]): Promise<{ handlers: Named[]; added: Named[] }> {
  if (process.platform !== "darwin") {
    return { handlers: [{ id: OPEN_IN_DEFAULT_APP, name: "Default app" }], added: added.map((id) => ({ id, name: plainName(id) })) };
  }
  const key = listKey(target, added);
  const cached = lists.get(key);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.value;
  const value = run("osascript", ["-l", "JavaScript", "-e", LAUNCH_SERVICES_SCRIPT, target, ...added], { timeout: 10_000, maxBuffer: 8_000_000 })
    .then(({ stdout }) => {
      const parsed = JSON.parse(stdout) as { handlers: Named[]; added: Named[] };
      const tidy = (item: Named): Named => ({ ...item, name: plainName(item.name || item.id) });
      return { handlers: parsed.handlers.map(tidy), added: parsed.added.map(tidy) };
    });
  lists.set(key, { at: Date.now(), value });
  value.catch(() => lists.delete(key));
  return value;
}

/** Off macOS, where the script above does not run. */
function iconFor(id: string): Promise<string | undefined> {
  if (id === OPEN_IN_DEFAULT_APP) return Promise.resolve(undefined);
  let icon = icons.get(id);
  if (!icon) {
    icon = app.getFileIcon(id, { size: "normal" }).then((image) => image.isEmpty() ? undefined : image.toDataURL(), () => undefined);
    icons.set(id, icon);
  }
  return icon;
}

/** The apps that can open `target` (a folder when omitted), with the user's additions and removals applied. */
export async function openInCatalog(settings: CapsuleSettings, target?: string): Promise<OpenInCatalog> {
  const own = ownBundle();
  const added = (settings.openInApps ?? []).filter((id) => existsSync(id));
  const { handlers, added: addedNamed } = await systemList(target ?? homedir(), added);
  const merged = mergeOpenInApps(handlers.filter((item) => item.id !== own), addedNamed, settings.openInHidden ?? []);
  const apps = await Promise.all(merged.map(async (item) => ({ ...item, icon: item.icon ?? await iconFor(item.id) })));
  return {
    apps,
    favorite: settings.openInFavorite,
    hidden: settings.openInHidden?.length ?? 0,
    discovery: process.platform === "darwin" ? "system" : "manual",
  };
}

/** Open `location` (already resolved and contained by the engine) with an app from the catalog. */
export async function openWithApp(catalog: OpenInCatalog, appId: string, location: string): Promise<void> {
  const chosen = catalog.apps.find((item) => item.id === appId);
  if (!chosen) throw new Error("That app is not in the Open in list for this item.");
  if (chosen.id === OPEN_IN_DEFAULT_APP) {
    const failure = await shell.openPath(location);
    if (failure) throw new Error(failure);
    return;
  }
  if (process.platform === "darwin") {
    try {
      await run("open", ["-a", chosen.id, location], { timeout: 15_000 });
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr?.trim();
      throw new Error(`${chosen.name} could not open ${path.basename(location)}.${detail ? ` ${detail}` : ""}`);
    }
    return;
  }
  const child = spawn(chosen.id, [location], { detached: true, stdio: "ignore", cwd: path.dirname(location) });
  await new Promise<void>((resolve, reject) => {
    child.once("error", (error) => reject(new Error(`${chosen.name} could not start: ${error.message}`)));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

/** Whether a picked file is an app this platform can launch with a path. */
function isLaunchableApp(location: string): boolean {
  if (process.platform === "darwin") return /\.app$/i.test(location) && existsSync(path.join(location, "Contents"));
  try { accessSync(location, constants.X_OK); return statSync(location).isFile(); } catch { return false; }
}

/** Ask for an app to add; returns the settings patch, or undefined when cancelled. */
export async function pickOpenInApp(settings: CapsuleSettings, win: BrowserWindow | null): Promise<Partial<CapsuleSettings> | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: "Add an app to Open in",
    buttonLabel: "Add",
    properties: ["openFile"],
    ...(process.platform === "darwin"
      ? { defaultPath: "/Applications", filters: [{ name: "Applications", extensions: ["app"] }] }
      : {}),
  };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  const picked = result.canceled ? undefined : result.filePaths[0];
  if (!picked) return undefined;
  if (!isLaunchableApp(picked)) {
    throw new Error(process.platform === "darwin" ? "Choose an application (.app)." : "Choose a program file this computer can run.");
  }
  lists.clear();
  return {
    openInApps: [...(settings.openInApps ?? []).filter((id) => id !== picked), picked],
    openInHidden: (settings.openInHidden ?? []).filter((id) => id !== picked),
  };
}
