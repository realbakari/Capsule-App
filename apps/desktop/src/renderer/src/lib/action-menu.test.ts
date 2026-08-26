import { describe, expect, it } from "vitest";
import {
  buildProjectActionMenuItems,
  buildSessionActionMenuItems,
  estimateMenuSize,
  nextSelectableIndex,
  placeActionMenu,
  selectableMenuItems,
  typeaheadMenuIndex,
} from "./action-menu.js";

describe("buildSessionActionMenuItems", () => {
  it("pins, archives, and marks delete as destructive", () => {
    const items = buildSessionActionMenuItems({ pinned: false });
    expect(items.map((item) => item.id)).toEqual([
      "rename",
      "pin",
      "generate-title",
      "archive",
      "delete",
    ]);
    expect(
      buildSessionActionMenuItems({ pinned: false, hasFolder: true }).map((item) => item.id),
    ).toEqual([
      "rename",
      "pin",
      "generate-title",
      "open-folder",
      "copy-path",
      "archive",
      "delete",
    ]);
    expect(items.find((item) => item.id === "archive")?.separatorBefore).toBe(true);
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });

  it("swaps pin for unpin", () => {
    expect(buildSessionActionMenuItems({ pinned: true }).map((item) => item.id)).toContain("unpin");
  });
});

describe("buildProjectActionMenuItems", () => {
  it("gates folder actions and delete", () => {
    const items = buildProjectActionMenuItems({
      hasFolder: false,
      canDelete: false,
      canRename: false,
    });
    expect(items.find((item) => item.id === "rename")?.enabled).toBe(false);
    expect(items.find((item) => item.id === "open-folder")?.enabled).toBe(false);
    expect(items.find((item) => item.id === "copy-path")?.enabled).toBe(false);
    expect(items.find((item) => item.id === "delete")?.enabled).toBe(false);
    expect(items.find((item) => item.id === "new-conversation")?.enabled).not.toBe(false);
    expect(items.find((item) => item.id === "change-folder")?.enabled).not.toBe(false);
    expect(items.find((item) => item.id === "add-folder")?.enabled).not.toBe(false);
  });

  it("enables folder actions when a path exists", () => {
    const items = buildProjectActionMenuItems({
      hasFolder: true,
      canDelete: true,
      canRename: true,
    });
    expect(items.find((item) => item.id === "open-folder")?.enabled).not.toBe(false);
    expect(items.find((item) => item.id === "delete")?.destructive).toBe(true);
  });
});

describe("menu keyboard helpers", () => {
  it("skips disabled items when moving", () => {
    const items = buildProjectActionMenuItems({
      hasFolder: false,
      canDelete: false,
      canRename: false,
    });
    const selectable = selectableMenuItems(items);
    expect(selectable.map((item) => item.id)).toEqual([
      "new-conversation",
      "change-folder",
      "add-folder",
    ]);
    expect(nextSelectableIndex(items, undefined, 1)).toBe(0);
  });

  it("typeahead jumps to the next matching label", () => {
    const items = buildSessionActionMenuItems({ pinned: false });
    const index = typeaheadMenuIndex(items, "d");
    expect(selectableMenuItems(items)[index]?.id).toBe("delete");
  });
});

describe("placeActionMenu", () => {
  it("aligns an anchored menu to the trigger and flips when it would overflow", () => {
    const placed = placeActionMenu({
      menuWidth: 200,
      menuHeight: 180,
      viewportWidth: 1280,
      viewportHeight: 220,
      pointerX: 40,
      pointerY: 40,
      anchor: { left: 20, top: 40, right: 44, bottom: 56, width: 24, height: 16 },
    });
    expect(placed.top).toBeLessThan(56);
    expect(placed.left + 200).toBeLessThanOrEqual(1280 - 8);
  });

  it("flips a pointer menu into the viewport near the bottom-right", () => {
    const placed = placeActionMenu({
      menuWidth: 220,
      menuHeight: 200,
      viewportWidth: 400,
      viewportHeight: 300,
      pointerX: 390,
      pointerY: 280,
    });
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.left + 220).toBeLessThanOrEqual(392);
    expect(placed.top + 200).toBeLessThanOrEqual(292);
  });

  it("estimates a compact size from the item list", () => {
    const size = estimateMenuSize(buildSessionActionMenuItems({ pinned: false }));
    expect(size.width).toBeGreaterThan(160);
    expect(size.height).toBeGreaterThan(100);
  });
});
