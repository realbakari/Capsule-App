import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveTextAttachment(directory: string, text: unknown): Promise<string> {
  if (typeof text !== "string" || !text.length || Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw new Error("Pasted text must contain between 1 byte and 2 MB of UTF-8 text.");
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `Pasted text ${randomUUID()}.txt`);
  await writeFile(file, text, { flag: "wx", mode: 0o600 });
  return file;
}
