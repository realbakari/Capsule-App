import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeFileName } from "@capsule/shared";

/**
 * Saves text as an attachment file. A name, when given, becomes the file's
 * name inside its own folder: the agent sees "Diff - Branch.md" rather than a
 * random id, and two attachments with the same name never collide.
 */
export async function saveTextAttachment(directory: string, text: unknown, name?: unknown): Promise<string> {
  if (typeof text !== "string" || !text.length || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw new Error("Pasted text must contain between 1 byte and 2 MB of UTF-8 text.");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safe = typeof name === "string"
    ? safeFileName(name).replace(/^[.\s]+/u, "").slice(0, 120)
    : "";
  if (!safe) {
    const file = path.join(directory, `Pasted text ${randomUUID()}.txt`);
    await writeFile(file, text, { flag: "wx", mode: 0o600 });
    return file;
  }
  const folder = path.join(directory, randomUUID());
  await mkdir(folder, { mode: 0o700 });
  const file = path.join(folder, /\.(md|txt)$/iu.test(safe) ? safe : `${safe}.md`);
  await writeFile(file, text, { flag: "wx", mode: 0o600 });
  return file;
}
