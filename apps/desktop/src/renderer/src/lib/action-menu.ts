import type { PopupMenuItem } from "@capsule/shared";

export type ActionMenuIcon =
  | "pencil"
  | "pin"
  | "pin-off"
  | "refresh"
  | "archive"
  | "trash"
  | "plus"
  | "folder"
  | "copy"
  | "settings"
  | "star"
  | "star-off"
  | "bell"
  | "bell-off"
  | "branch"
  | "folder-plus"
  | "file"
  | "message"
  | "history"
  | "merge"
  | "link"
  | "pause"
  | "play"
  | "tag"
  | "bookmark";

export type SessionActionId =
  | "rename"
  | "pin"
  | "unpin"
  | "generate-title"
  | "open-folder"
  | "copy-path"
  | "apply-to-local"
  | "pause"
  | "resume"
  | "tags"
  | "keep"
  | "export-markdown"
  | "copy-markdown"
  | "share-link"
  | "handoff"
  | "archive"
  | "delete";
export type ProjectActionId =
  | "rename"
  | "new-conversation"
  | "import-sessions"
  | "change-folder"
  | "add-folder"
  | "open-folder"
  | "copy-path"
  | "delete";

export interface ActionMenuItem extends PopupMenuItem {
  icon?: ActionMenuIcon;
  shortcut?: string;
  /** Why a disabled item is disabled. */
  title?: string;
}

export interface MenuAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function copyAnchor(rect: {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}): MenuAnchor {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

/** Thread lifecycle entries; each is absent where it does not apply or the device may only read. */
export interface ThreadMenuState {
  pause?: "pause" | "resume";
  tags?: boolean;
  /** A temporary thread can be kept. */
  keep?: boolean;
}

export function buildSessionActionMenuItems(state: {
  pinned: boolean;
  thread?: ThreadMenuState;
  hasFolder?: boolean;
  /** Present for a worktree thread on the desktop; the reason disables it. */
  applyToLocal?: { disabledReason?: string };
  /** Export writes a file and a link opens a listener: both belong to the desktop. */
  share?: { exportOffered: boolean; shareOffered: boolean };
  /** Hand off to a new conversation; absent where it is unavailable. */
  handoff?: boolean;
  /** A read-only paired device: only the items that copy or read remain. */
  readOnly?: boolean;
}): ActionMenuItem[] {
  const items: ActionMenuItem[] = [
    { id: "rename", label: "Rename", icon: "pencil" },
    {
      id: state.pinned ? "unpin" : "pin",
      label: state.pinned ? "Unpin" : "Pin",
      icon: state.pinned ? "pin-off" : "pin",
    },
    { id: "generate-title", label: "Generate title", icon: "refresh" },
    ...(state.thread?.keep ? [{ id: "keep" as const, label: "Keep this conversation", icon: "bookmark" as const, separatorBefore: true }] : []),
    ...(state.thread?.tags ? [{ id: "tags" as const, label: "Tags…", icon: "tag" as const, separatorBefore: !state.thread.keep }] : []),
    ...(state.thread?.pause ? [{
      id: state.thread.pause,
      label: state.thread.pause === "pause" ? "Pause" : "Resume",
      icon: state.thread.pause === "pause" ? "pause" as const : "play" as const,
      separatorBefore: !state.thread.keep && !state.thread.tags,
    }] : []),
    ...(state.hasFolder
      ? [
          {
            id: "open-folder" as const,
            label: "Open folder",
            icon: "folder" as const,
            separatorBefore: true,
          },
          { id: "copy-path" as const, label: "Copy path", icon: "copy" as const },
        ]
      : []),
    ...(state.applyToLocal
      ? [{
          id: "apply-to-local" as const,
          label: "Apply to local checkout",
          icon: "merge" as const,
          separatorBefore: true,
          enabled: !state.applyToLocal.disabledReason,
          title: state.applyToLocal.disabledReason,
        }]
      : []),
    ...(state.share
      ? [
          ...(state.share.exportOffered ? [{ id: "export-markdown" as const, label: "Export as Markdown…", icon: "file" as const, separatorBefore: true }] : []),
          { id: "copy-markdown" as const, label: "Copy as Markdown", icon: "copy" as const, separatorBefore: !state.share.exportOffered },
          ...(state.share.shareOffered ? [{ id: "share-link" as const, label: "Share read-only link…", icon: "link" as const }] : []),
        ]
      : []),
    ...(state.handoff ? [{ id: "handoff" as const, label: "Hand off to a new conversation…", icon: "message" as const, separatorBefore: true }] : []),
    { id: "archive", label: "Archive", icon: "archive", separatorBefore: true },
    { id: "delete", label: "Delete", icon: "trash", destructive: true },
  ];
  if (!state.readOnly) return items;
  const reads = items.filter((item) => item.id === "copy-path" || item.id === "copy-markdown");
  return reads.map((item, index) => ({ ...item, separatorBefore: index > 0 && item.separatorBefore }));
}

export function buildProjectActionMenuItems(state: {
  hasFolder: boolean;
  canDelete: boolean;
  canRename: boolean;
  /** Import from the agents' own histories; absent where it is unavailable. */
  canImport?: boolean;
}): ActionMenuItem[] {
  return [
    { id: "settings", label: "Project settings", icon: "settings" },
    { id: "rename", label: "Rename", icon: "pencil", enabled: state.canRename },
    { id: "new-conversation", label: "New conversation", icon: "plus" },
    ...(state.canImport ? [{ id: "import-sessions" as const, label: "Import sessions…", icon: "history" as const, enabled: state.hasFolder, title: state.hasFolder ? undefined : "Attach a folder first. Sessions are matched to the folder they ran in." }] : []),
    {
      id: "change-folder",
      label: state.hasFolder ? "Change folder" : "Attach folder",
      icon: "folder",
      separatorBefore: true,
    },
    { id: "add-folder", label: "Add folder", icon: "folder" },
    {
      id: "open-folder",
      label: "Show in folder",
      icon: "folder",
      enabled: state.hasFolder,
    },
    { id: "copy-path", label: "Copy path", icon: "copy", enabled: state.hasFolder },
    {
      id: "delete",
      label: "Delete project",
      icon: "trash",
      destructive: true,
      enabled: state.canDelete,
      separatorBefore: true,
    },
  ];
}

export function selectableMenuItems(items: readonly ActionMenuItem[]): ActionMenuItem[] {
  return items.filter((item) => item.enabled !== false);
}

export function nextSelectableIndex(
  items: readonly ActionMenuItem[],
  currentId: string | undefined,
  direction: 1 | -1,
): number {
  const selectable = selectableMenuItems(items);
  if (selectable.length === 0) return -1;
  const current = currentId ? selectable.findIndex((item) => item.id === currentId) : -1;
  if (current < 0) return direction > 0 ? 0 : selectable.length - 1;
  return (current + direction + selectable.length) % selectable.length;
}

export function typeaheadMenuIndex(
  items: readonly ActionMenuItem[],
  query: string,
  currentId?: string,
): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return -1;
  const selectable = selectableMenuItems(items);
  if (selectable.length === 0) return -1;
  const start = currentId ? selectable.findIndex((item) => item.id === currentId) : -1;
  for (let offset = 1; offset <= selectable.length; offset += 1) {
    const index = (Math.max(start, -1) + offset) % selectable.length;
    if (selectable[index]?.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

export function estimateMenuSize(items: readonly ActionMenuItem[]): { width: number; height: number } {
  let height = 8;
  let width = 196;
  for (const item of items) {
    if (item.separatorBefore) height += 9;
    height += 28;
    width = Math.max(width, 44 + item.label.length * 7.4);
  }
  return { width: Math.min(320, width), height };
}

export function placeActionMenu(input: {
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  pointerX: number;
  pointerY: number;
  anchor?: MenuAnchor;
  margin?: number;
}): { left: number; top: number } {
  const margin = input.margin ?? 8;
  const maxLeft = Math.max(margin, input.viewportWidth - input.menuWidth - margin);
  const maxTop = Math.max(margin, input.viewportHeight - input.menuHeight - margin);
  if (input.anchor) {
    let left = input.anchor.right - input.menuWidth;
    let top = input.anchor.bottom + 4;
    if (top + input.menuHeight > input.viewportHeight - margin) {
      top = input.anchor.top - input.menuHeight - 4;
    }
    left = Math.min(Math.max(margin, left), maxLeft);
    top = Math.min(Math.max(margin, top), maxTop);
    return { left, top };
  }
  let left = input.pointerX;
  let top = input.pointerY;
  if (left + input.menuWidth > input.viewportWidth - margin) left = input.pointerX - input.menuWidth;
  if (top + input.menuHeight > input.viewportHeight - margin) top = input.pointerY - input.menuHeight;
  left = Math.min(Math.max(margin, left), maxLeft);
  top = Math.min(Math.max(margin, top), maxTop);
  return { left, top };
}
