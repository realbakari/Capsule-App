import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveImageAttachment(directory: string, png: Uint8Array): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `Pasted image ${randomUUID()}.png`);
  await writeFile(file, png, { flag: "wx", mode: 0o600 });
  return file;
}
