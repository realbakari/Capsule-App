import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { saveTextAttachment } from "./text-attachments";

it("writes private, unique UTF-8 attachments without overwriting the earlier paste", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "capsule-text-"));
  try {
    const content = "Notes\n界🙂";
    const first = await saveTextAttachment(directory, content);
    const second = await saveTextAttachment(directory, "second");
    expect(first).not.toBe(second);
    expect(path.dirname(first)).toBe(directory);
    expect(await readFile(first, "utf8")).toBe(content);
    if (process.platform !== "win32") expect((await stat(first)).mode & 0o777).toBe(0o600);
    for (const invalid of [undefined, "", "界".repeat(700_000)]) await expect(saveTextAttachment(directory, invalid)).rejects.toThrow("UTF-8");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
