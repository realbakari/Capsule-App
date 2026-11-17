import { describe, expect, it } from "vitest";
import {
  carriesFileRow,
  fileRowAbsolutePath,
  fileRowMention,
  fileRowMenuItems,
  FILE_ROW_DRAG_TYPE,
  readFileRowDrag,
  writeFileRowDrag,
} from "./file-row-actions";

const labels = (items: { label: string; separatorBefore?: boolean }[]) =>
  items.map((item) => `${item.separatorBefore ? "| " : ""}${item.label}`);

describe("fileRowMenuItems", () => {
  it("gives a file every action on the desktop, in groups", () => {
    expect(labels(fileRowMenuItems("file", { host: true, platform: "darwin", favorite: "/Applications/Code Editor.app" }))).toEqual([
      "Open",
      "Mention in composer",
      "| Open in Code Editor",
      "Reveal in Finder",
      "| Copy path",
      "Copy relative path",
    ]);
  });

  it("drops Open for a folder, which has no preview", () => {
    const items = fileRowMenuItems("directory", { host: true, platform: "darwin" });
    expect(items.map((item) => item.id)).toEqual(["mention", "open-in", "reveal", "copy-path", "copy-relative-path"]);
    expect(items[0]!.separatorBefore).toBeUndefined();
  });

  it("names the system's file manager", () => {
    const reveal = (platform?: string) => fileRowMenuItems("file", { host: true, platform }).find((item) => item.id === "reveal")?.label;
    expect(reveal("darwin")).toBe("Reveal in Finder");
    expect(reveal("win32")).toBe("Reveal in File Explorer");
    expect(reveal("linux")).toBe("Reveal in file manager");
  });

  it("opens with the default app until a favourite is chosen", () => {
    const openIn = (favorite?: string) => fileRowMenuItems("file", { host: true, favorite }).find((item) => item.id === "open-in")?.label;
    expect(openIn()).toBe("Open with default app");
    expect(openIn("default")).toBe("Open with default app");
    expect(openIn("C:\\Tools\\editor.exe")).toBe("Open in editor");
  });

  it("leaves out host actions on a paired device", () => {
    expect(fileRowMenuItems("file", { host: false }).map((item) => item.id)).toEqual(["preview", "mention", "copy-path", "copy-relative-path"]);
    expect(fileRowMenuItems("directory", { host: false }).map((item) => item.id)).toEqual(["mention", "copy-path", "copy-relative-path"]);
  });
});

describe("file row paths", () => {
  it("joins the row to its folder in that folder's separator", () => {
    expect(fileRowAbsolutePath({ root: "/work/app/", path: "src/a.ts" })).toBe("/work/app/src/a.ts");
    expect(fileRowAbsolutePath({ root: "C:\\work\\app", path: "src/a.ts" })).toBe("C:\\work\\app\\src\\a.ts");
  });

  it("mentions a row in another of the project's folders under that folder's name", () => {
    expect(fileRowMention({ root: "/work/app", path: "src/a.ts" }, "/work/app")).toBe("src/a.ts");
    expect(fileRowMention({ root: "/work/docs", path: "guide.md" }, "/work/app")).toBe("docs/guide.md");
  });
});

describe("file row drag", () => {
  function transfer() {
    const data = new Map<string, string>();
    return { data, effectAllowed: "all" as DataTransfer["effectAllowed"], setData: (type: string, value: string) => { data.set(type, value); }, getData: (type: string) => data.get(type) ?? "" };
  }

  it("round-trips the row and offers the path as text", () => {
    const drag = transfer();
    writeFileRowDrag(drag, { root: "/work/app", path: "src/a.ts" });
    expect(carriesFileRow(drag.data.keys())).toBe(true);
    expect(drag.data.get("text/plain")).toBe("src/a.ts");
    expect(drag.effectAllowed).toBe("copy");
    expect(readFileRowDrag(drag)).toEqual({ root: "/work/app", path: "src/a.ts" });
  });

  it("ignores drags that are not a tree row", () => {
    expect(carriesFileRow(["Files", "text/plain"])).toBe(false);
    const drag = transfer();
    expect(readFileRowDrag(drag)).toBeUndefined();
    for (const raw of ["not json", "null", "{}", '{"root":"/a","path":""}', '{"root":"/a","path":"/etc/passwd"}', '{"root":"/a","path":"../up"}', '{"root":1,"path":"a"}']) {
      drag.data.set(FILE_ROW_DRAG_TYPE, raw);
      expect(readFileRowDrag(drag), raw).toBeUndefined();
    }
  });
});
