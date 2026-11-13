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
  | "check"
  | "clock"
  | "dot";

export type SessionActionId =
  | "rename"
  | "pin"
  | "unpin"
  | "generate-title"
  | "open-folder"
  | "copy-path"
  | "archive"
  | "delete"
  | "mark-unread"
  | "mark-read"
  | "settle"
  | "unsettle"
  | "snooze"
  | "wake"
  | "copy-markdown"
  | "copy-branch";
export type ProjectActionId =
  | "rename"
  | "new-conversation"
  | "change-folder"
  | "add-folder"
  | "open-folder"
  | "copy-path"
  | "delete";

export interface ActionMenuItem extends PopupMenuItem {
  icon?: ActionMenuIcon;
  shortcut?: string;
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

export function buildSessionActionMenuItems(state: {
  pinned: boolean;
  hasFolder?: boolean;
  /** Triage needs the desktop; a paired viewer reads but never writes it. */
  triage?: { unread: boolean; canMarkUnread: boolean; shelf: "active" | "settled" | "snoozed" };
  branch?: string;
}): ActionMenuItem[] {
  const triage = state.triage;
  const triageItems: ActionMenuItem[] = triage ? [
    triage.unread
      ? { id: "mark-read", label: "Mark as read", icon: "check" }
      : { id: "mark-unread", label: "Mark unread", icon: "dot", enabled: triage.canMarkUnread, shortcut: "⇧⌘U" },
    triage.shelf === "settled"
      ? { id: "unsettle", label: "Return to active", icon: "refresh" }
      : { id: "settle", label: "Settle", icon: "check" },
    triage.shelf === "snoozed"
      ? { id: "wake", label: "Wake now", icon: "bell" }
      : { id: "snooze", label: "Snooze…", icon: "clock" },
  ] : [];
  return [
    ...triageItems,
    { id: "rename", label: "Rename", icon: "pencil", separatorBefore: triageItems.length > 0 },
    {
      id: state.pinned ? "unpin" : "pin",
      label: state.pinned ? "Unpin" : "Pin",
      icon: state.pinned ? "pin-off" : "pin",
    },
    { id: "generate-title", label: "Generate title", icon: "refresh" },
    { id: "copy-markdown", label: "Copy as Markdown", icon: "copy", separatorBefore: true },
    ...(state.branch ? [{ id: "copy-branch" as const, label: "Copy branch name", icon: "copy" as const }] : []),
    ...(state.hasFolder
      ? [
          {
            id: "open-folder" as const,
            label: "Open folder",
            icon: "folder" as const,
          },
          { id: "copy-path" as const, label: "Copy path", icon: "copy" as const },
        ]
      : []),
    { id: "archive", label: "Archive", icon: "archive", separatorBefore: true },
    { id: "delete", label: "Delete", icon: "trash", destructive: true },
  ];
}

export function buildProjectActionMenuItems(state: {
  hasFolder: boolean;
  canDelete: boolean;
  canRename: boolean;
}): ActionMenuItem[] {
  return [
    { id: "settings", label: "Project settings", icon: "settings" },
    { id: "rename", label: "Rename", icon: "pencil", enabled: state.canRename },
    { id: "new-conversation", label: "New conversation", icon: "plus" },
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
