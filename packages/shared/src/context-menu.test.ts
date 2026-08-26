import { describe, expect, it } from "vitest";
import { popupItemsToNativeTemplate, type PopupMenuItem } from "./context-menu.js";

describe("popupItemsToNativeTemplate", () => {
  it("inserts separators and nested children", () => {
    const items: PopupMenuItem[] = [
      { id: "rename", label: "Rename" },
      { id: "copy", label: "Copy", separatorBefore: true, children: [{ id: "copy-path", label: "Path" }] },
      { id: "delete", label: "Delete", destructive: true, separatorBefore: true },
    ];
    expect(popupItemsToNativeTemplate(items)).toEqual([
      { type: "normal", id: "rename", label: "Rename", enabled: true },
      { type: "separator" },
      {
        type: "normal",
        id: "copy",
        label: "Copy",
        enabled: true,
        submenu: [{ type: "normal", id: "copy-path", label: "Path", enabled: true }],
      },
      { type: "separator" },
      { type: "normal", id: "delete", label: "Delete", enabled: true },
    ]);
  });

  it("honors disabled items", () => {
    expect(
      popupItemsToNativeTemplate([{ id: "open", label: "Open folder", enabled: false }]),
    ).toEqual([{ type: "normal", id: "open", label: "Open folder", enabled: false }]);
  });
});
