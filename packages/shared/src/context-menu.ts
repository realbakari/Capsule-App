/** Serializable menu payload for the desktop popup (native or in-app). */
export interface PopupMenuItem {
  id: string;
  label: string;
  enabled?: boolean;
  destructive?: boolean;
  separatorBefore?: boolean;
  children?: PopupMenuItem[];
}

export interface PopupMenuRequest {
  items: PopupMenuItem[];
  x: number;
  y: number;
}

export type NativeMenuNode =
  | { type: "separator" }
  | {
      type: "normal";
      id: string;
      label: string;
      enabled: boolean;
      submenu?: NativeMenuNode[];
    };

export function popupItemsToNativeTemplate(items: readonly PopupMenuItem[]): NativeMenuNode[] {
  const template: NativeMenuNode[] = [];
  for (const item of items) {
    if (item.separatorBefore) template.push({ type: "separator" });
    if (item.children && item.children.length > 0) {
      template.push({
        type: "normal",
        id: item.id,
        label: item.label,
        enabled: item.enabled !== false,
        submenu: popupItemsToNativeTemplate(item.children),
      });
      continue;
    }
    template.push({
      type: "normal",
      id: item.id,
      label: item.label,
      enabled: item.enabled !== false,
    });
  }
  return template;
}
