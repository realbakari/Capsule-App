import fs from "node:fs";
import { open } from "node:fs/promises";
import { validateOpenedFile } from "./contained-path.js";

const READ_FLAGS = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW;

export class FileTooLargeError extends Error {
  constructor(readonly size: number, readonly limit: number) {
    super(`File is too large to read (limit ${limit} bytes).`);
  }
}

function readBuffer(stat: fs.Stats, limit: number): Buffer {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid file read limit.");
  if (!stat.isFile()) throw new Error("Only regular files can be read.");
  if (stat.size > limit) throw new FileTooLargeError(stat.size, limit);
  // The extra byte detects growth without ever allocating an unbounded buffer.
  return Buffer.alloc(stat.size + 1);
}

function checkedBytes(buffer: Buffer, length: number): Buffer {
  if (length === buffer.length) throw new Error("File changed while reading it. Try again.");
  return buffer.subarray(0, length);
}

/** Check type and size on the descriptor we read, never on an earlier pathname. */
export function readBoundedFileSync(file: string, limit: number, projectRoot?: string): Buffer {
  const descriptor = fs.openSync(file, READ_FLAGS);
  try {
    const stat = fs.fstatSync(descriptor);
    const buffer = readBuffer(stat, limit);
    validateOpenedFile(file, stat, projectRoot);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (count === 0) break;
      length += count;
    }
    return checkedBytes(buffer, length);
  } finally {
    fs.closeSync(descriptor);
  }
}

export async function readBoundedFile(file: string, limit: number, projectRoot?: string): Promise<Buffer> {
  const handle = await open(file, READ_FLAGS);
  try {
    const stat = await handle.stat();
    const buffer = readBuffer(stat, limit);
    validateOpenedFile(file, stat, projectRoot);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    return checkedBytes(buffer, length);
  } finally {
    await handle.close();
  }
}
