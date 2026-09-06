import { describe, expect, it } from "vitest";
import { previewFromBytes, readPreviewFile } from "./preview.js";
import { mkdtemp, open } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

describe("file preview", () => {
  it("rejects an oversized sparse image before reading its bytes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "capsule-preview-"));
    const file = path.join(dir, "large.png");
    const handle = await open(file, "w");
    await handle.truncate(500_000_000);
    await handle.close();
    expect(await readPreviewFile(file, "large.png")).toMatchObject({ kind: "binary", truncated: true, size: 500_000_000 });
  });

  it.skipIf(process.platform === "win32")("rejects a FIFO without waiting for a writer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "capsule-preview-fifo-"));
    const file = path.join(dir, "pipe.txt");
    execFileSync("mkfifo", [file]);
    await expect(readPreviewFile(file, "pipe.txt")).rejects.toThrow("regular files");
  }, 2000);
  it("renders a PNG as an image data URL", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
    const preview = previewFromBytes("assets/logo.png", png);
    expect(preview.kind).toBe("image");
    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(preview.size).toBe(png.length);
  });

  it("keeps source files as highlighted text", () => {
    const preview = previewFromBytes("src/index.ts", Buffer.from("export const n = 1;\n"));
    expect(preview.kind).toBe("text");
    expect(preview.language).toBe("ts");
    expect(preview.contents).toContain("export const n");
    expect(preview.truncated).toBe(false);
  });

  it("does not dump zip bytes as text", () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const preview = previewFromBytes("out/app.zip", zip);
    expect(preview.kind).toBe("binary");
    expect(preview.contents).toBeUndefined();
    expect(preview.dataUrl).toBeUndefined();
  });
});
