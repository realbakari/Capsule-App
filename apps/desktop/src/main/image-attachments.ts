import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveImageAttachment(directory: string, png: Uint8Array): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `Pasted image ${randomUUID()}.png`);
  await writeFile(file, png, { flag: "wx", mode: 0o600 });
  return file;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_LIMIT = 25 * 1024 * 1024;

/** PNG bytes from the renderer, or undefined for anything else. */
export function readPngBytes(value: unknown): Uint8Array | undefined {
  if (!(value instanceof Uint8Array) || value.byteLength < PNG_SIGNATURE.length || value.byteLength > PNG_LIMIT) return undefined;
  return PNG_SIGNATURE.every((byte, index) => value[index] === byte) ? value : undefined;
}
