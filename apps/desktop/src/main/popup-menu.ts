import { BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import {
  popupItemsToNativeTemplate,
  type NativeMenuNode,
  type PopupMenuRequest,
} from "@capsule/shared";

function attachClicks(
  nodes: NativeMenuNode[],
  onPick: (id: string) => void,
): MenuItemConstructorOptions[] {
  return nodes.map((node) => {
    if (node.type === "separator") return { type: "separator" };
    if (node.submenu) {
      return {
        label: node.label,
        enabled: node.enabled,
        submenu: attachClicks(node.submenu, onPick),
      };
    }
    return {
      id: node.id,
      label: node.label,
      enabled: node.enabled,
      click: () => onPick(node.id),
    };
  });
}

export function popupContextMenu(
  event: Electron.IpcMainInvokeEvent,
  request: PopupMenuRequest,
): Promise<string | null> {
  const items = Array.isArray(request?.items) ? request.items : [];
  if (items.length === 0) return Promise.resolve(null);
  const x = Number(request.x);
  const y = Number(request.y);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (id: string | null) => {
      if (settled) return;
      settled = true;
      resolve(id);
    };
    const template = attachClicks(popupItemsToNativeTemplate(items), finish);
    const menu = Menu.buildFromTemplate(template);
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    menu.popup({
      window,
      x: Number.isFinite(x) ? Math.round(x) : undefined,
      y: Number.isFinite(y) ? Math.round(y) : undefined,
      callback: () => finish(null),
    });
  });
}
