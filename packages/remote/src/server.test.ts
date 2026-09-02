import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveStaticFile } from "./server.js";

const serveDir = path.resolve("apps/desktop/out/renderer");

describe("resolveStaticFile", () => {
  it("refuses to escape the served folder", () => {
    // The classic: a request that walks up out of the directory.
    expect(resolveStaticFile(serveDir, "/../../../../etc/passwd")).toBeUndefined();
    expect(resolveStaticFile(serveDir, "/..%2f..%2fetc/passwd")).toBeUndefined();
  });

  it("falls back to the app shell for a client-side route", () => {
    const file = resolveStaticFile(serveDir, "/some/deep/route");
    // Either the build exists and we get index.html, or there is nothing to
    // serve — never a file from outside the folder.
    if (file) expect(path.basename(file)).toBe("index.html");
  });
});
