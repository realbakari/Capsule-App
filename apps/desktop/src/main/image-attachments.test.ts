import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { saveImageAttachment } from "./image-attachments";

it("keeps concurrent image pastes distinct even at exactly the same timestamp", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "capsule-images-"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
  try {
    const contents = [Buffer.from("first image"), Buffer.from("second image")];
    const files = await Promise.all(contents.map((content) => saveImageAttachment(directory, content)));
    expect(new Set(files).size).toBe(2);
    expect(await Promise.all(files.map((file) => readFile(file)))).toEqual(contents);
    if (process.platform !== "win32") expect((await stat(files[0]!)).mode & 0o777).toBe(0o600);
  } finally { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); }
});
