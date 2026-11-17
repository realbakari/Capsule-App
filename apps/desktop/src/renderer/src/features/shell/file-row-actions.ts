import { folderBasename, OPEN_IN_DEFAULT_APP } from "@capsule/shared";
import type { ActionMenuIcon, ActionMenuItem } from "../../lib/action-menu";

export type FileRowKind = "file" | "directory";

/** A row in the Files tree: a path relative to the folder the tree shows. */
export interface FileRow {
  root: string;
  path: string;
  kind: FileRowKind;
}

export type FileRowAction = "preview" | "mention" | "open-in" | "reveal" | "copy-path" | "copy-relative-path";

export interface FileRowMenuContext {
  /** False on a paired device: opening in an app and revealing happen on the host. */
  host: boolean;
  platform?: string;
  /** The Open in favourite's location on disk, or the default app. */
  favorite?: string;
}

interface RowActionSpec {
  id: FileRowAction;
  label: (context: FileRowMenuContext) => string;
  icon?: ActionMenuIcon;
  kinds: readonly FileRowKind[];
  hostOnly?: boolean;
  separatorBefore?: boolean;
}

const BOTH: readonly FileRowKind[] = ["file", "directory"];

const ROW_ACTIONS: readonly RowActionSpec[] = [
  { id: "preview", label: () => "Open", icon: "file", kinds: ["file"] },
  { id: "mention", label: () => "Mention in composer", icon: "message", kinds: BOTH },
  { id: "open-in", label: (context) => openInLabel(context.favorite), icon: "external", kinds: BOTH, hostOnly: true, separatorBefore: true },
  { id: "reveal", label: (context) => revealLabel(context.platform), icon: "folder", kinds: BOTH, hostOnly: true },
  { id: "copy-path", label: () => "Copy path", icon: "copy", kinds: BOTH, separatorBefore: true },
  { id: "copy-relative-path", label: () => "Copy relative path", kinds: BOTH },
];

export function revealLabel(platform: string | undefined): string {
  if (platform === "darwin") return "Reveal in Finder";
  if (platform === "win32") return "Reveal in File Explorer";
  return "Reveal in file manager";
}

/** The favourite by the name its bundle or program carries, as Open in lists it. */
function openInLabel(favorite: string | undefined): string {
  if (!favorite || favorite === OPEN_IN_DEFAULT_APP) return "Open with default app";
  const name = favorite.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1)?.replace(/\.(app|exe)$/i, "");
  return name ? `Open in ${name}` : "Open with default app";
}

export function fileRowMenuItems(kind: FileRowKind, context: FileRowMenuContext): ActionMenuItem[] {
  const items: ActionMenuItem[] = [];
  for (const spec of ROW_ACTIONS) {
    if (!spec.kinds.includes(kind) || (spec.hostOnly && !context.host)) continue;
    items.push({
      id: spec.id,
      label: spec.label(context),
      icon: spec.icon,
      separatorBefore: items.length > 0 && spec.separatorBefore ? true : undefined,
    });
  }
  return items;
}

export function isFileRowAction(id: string): id is FileRowAction {
  return ROW_ACTIONS.some((spec) => spec.id === id);
}

/** The row's absolute path, in the root's own separator. */
export function fileRowAbsolutePath(row: Pick<FileRow, "root" | "path">): string {
  const windows = row.root.includes("\\") && !row.root.includes("/");
  const separator = windows ? "\\" : "/";
  const relative = windows ? row.path.replaceAll("/", "\\") : row.path;
  return `${row.root.replace(/[\\/]+$/, "")}${separator}${relative}`;
}

/** A row in another of the project's folders is mentioned under that folder's name. */
export function fileRowMention(row: Pick<FileRow, "root" | "path">, conversationRoot: string | undefined): string {
  return row.root !== conversationRoot ? `${folderBasename(row.root)}/${row.path}` : row.path;
}

export const FILE_ROW_DRAG_TYPE = "application/x-capsule-path";

interface DragWriter {
  setData(format: string, data: string): void;
  effectAllowed: DataTransfer["effectAllowed"];
}

export function writeFileRowDrag(transfer: DragWriter, row: Pick<FileRow, "root" | "path">): void {
  transfer.setData(FILE_ROW_DRAG_TYPE, JSON.stringify({ root: row.root, path: row.path }));
  // Other targets (a terminal, another app) take the path as text.
  transfer.setData("text/plain", row.path);
  transfer.effectAllowed = "copy";
}

/** During dragover only the types are readable, not the data. */
export function carriesFileRow(types: Iterable<string>): boolean {
  return Array.from(types).includes(FILE_ROW_DRAG_TYPE);
}

export function readFileRowDrag(transfer: Pick<DataTransfer, "getData">): Pick<FileRow, "root" | "path"> | undefined {
  const raw = transfer.getData(FILE_ROW_DRAG_TYPE);
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return undefined;
    const { root, path } = value as Record<string, unknown>;
    if (typeof root !== "string" || typeof path !== "string" || !root || !path) return undefined;
    if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) return undefined;
    return { root, path };
  } catch {
    return undefined;
  }
}
