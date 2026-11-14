import { describe, expect, it } from "vitest";
import { bufferRange, findTerminalLinks, logicalLine, osc7Folder, resolveTerminalPath, terminalLinkHint, type BufferLineLike } from "./terminal-links.js";

const context = { cwd: "/work/app/packages/web", roots: ["/work/app", "/work/docs"] };
const targets = (line: string) => findTerminalLinks(line, context).map((link) => [link.text, link.target]);

describe("findTerminalLinks", () => {
  it("sends a local server to the Browser panel and other sites outside", () => {
    expect(targets("  ➜  Local:   http://localhost:5173/ ")).toEqual([
      ["http://localhost:5173/", { kind: "browser", url: "http://localhost:5173/" }],
    ]);
    expect(targets("ready on http://127.0.0.1:3000, docs at https://example.com/guide.")).toEqual([
      ["http://127.0.0.1:3000", { kind: "browser", url: "http://127.0.0.1:3000/" }],
      ["https://example.com/guide", { kind: "external", url: "https://example.com/guide" }],
    ]);
    expect(targets("(see http://app.localhost:8080/a)")[0]?.[1]).toEqual({ kind: "browser", url: "http://app.localhost:8080/a" });
  });

  it("links a file with its position, read against the shell's folder", () => {
    expect(targets("src/app.ts:12:3: error TS2322")).toEqual([
      ["src/app.ts:12:3", { kind: "file", root: "/work/app", path: "packages/web/src/app.ts", line: 12, column: 3 }],
    ]);
    expect(targets("at ../../README.md")).toEqual([
      ["../../README.md", { kind: "file", root: "/work/app", path: "README.md" }],
    ]);
    expect(targets("open /work/docs/guide/intro.md:4")).toEqual([
      ["/work/docs/guide/intro.md:4", { kind: "file", root: "/work/docs", path: "guide/intro.md", line: 4 }],
    ]);
    expect(targets("index.ts:40 boom")[0]?.[1]).toMatchObject({ path: "packages/web/index.ts", line: 40 });
  });

  it("leaves out paths outside the conversation's folders and words that only look like paths", () => {
    expect(targets("/usr/local/bin/node.js and ../../../etc/hosts.txt")).toEqual([]);
    expect(targets("read and/or write src/lib then 1.2.3 and README.md")).toEqual([]);
    expect(targets("git@github.com:acme/widgets.git redis://cache/0.db")).toEqual([]);
  });

  it("does not read the path inside a URL as a file", () => {
    expect(targets("http://localhost:3000/src/app.ts").map(([, target]) => (target as { kind: string }).kind)).toEqual(["browser"]);
  });
});

describe("resolveTerminalPath", () => {
  it("prefers the deepest root and refuses a path that climbs out", () => {
    const nested = { cwd: "/work/app", roots: ["/work/app", "/work/app/packages/web"] };
    expect(resolveTerminalPath("packages/web/a.ts", nested)).toEqual({ kind: "file", root: "/work/app/packages/web", path: "a.ts" });
    expect(resolveTerminalPath("../other/a.ts", nested)).toBeUndefined();
  });
});

describe("wrapped lines", () => {
  const rows = (texts: string[], wrapped: boolean[]): ((row: number) => BufferLineLike | undefined) =>
    (row) => texts[row] === undefined ? undefined : { isWrapped: wrapped[row] ?? false, translateToString: (trim) => trim ? texts[row]!.trimEnd() : texts[row]! };

  it("joins every row of a wrapped URL, from any of its rows, and maps it back to cells", () => {
    const get = rows(["$ echo", "see http://loc", "alhost:3000/a ", "next"], [false, false, true, false]);
    const line = logicalLine(get, 2)!;
    expect(line.text).toBe("see http://localhost:3000/a");
    expect(logicalLine(get, 1)).toEqual(line);
    const [link] = findTerminalLinks(line.text, context);
    expect(link?.text).toBe("http://localhost:3000/a");
    expect(bufferRange(line, link!.start, link!.end)).toEqual({ start: { x: 5, y: 2 }, end: { x: 13, y: 3 } });
  });
});

describe("osc7Folder", () => {
  it("reads the folder a shell reports and ignores anything else", () => {
    expect(osc7Folder("file://mac.local/Users/me/My%20App")).toBe("/Users/me/My App");
    expect(osc7Folder("https://example.com/")).toBeUndefined();
    expect(osc7Folder("not a url")).toBeUndefined();
  });
});

describe("terminalLinkHint", () => {
  it("says what a click does and what needs the modifier", () => {
    expect(terminalLinkHint({ kind: "external", url: "https://example.com/" }, "⌘")).toBe("⌘-click to open in your default browser.");
    expect(terminalLinkHint({ kind: "file", root: "/r", path: "a.ts", line: 3 }, "⌘")).toBe("Open a.ts:3 in Files.");
  });
});
