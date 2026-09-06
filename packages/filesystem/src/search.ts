import fs from "node:fs/promises";
import path from "node:path";
import type { ContentHit } from "@capsule/shared";
import { projectFiles } from "./file-index.js";

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mov|dylib|so|o)$/i;
const MAX_FILE_BYTES = 400_000;

/** Async, ignore-aware search. Only four files are read at once. */
export async function searchContents(projectRoot: string | undefined, query: string, limit = 60): Promise<ContentHit[]> {
  const needle = query.trim().toLowerCase();
  if (!projectRoot || !needle || limit <= 0) return [];
  const root = await fs.realpath(projectRoot);
  const files = await projectFiles(root);
  const hits: ContentHit[] = [];
  const scan = async (relative: string): Promise<ContentHit[]> => {
    if (BINARY.test(relative)) return [];
    try {
      const full = await fs.realpath(path.resolve(root, relative));
      const inside = path.relative(root, full);
      if (inside === ".." || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside)) return [];
      const stat = await fs.stat(full);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];
      const handle = await fs.open(full, "r");
      let text: string;
      try {
        // Files growing during a search must not cause an unbounded read.
        const buffer = Buffer.alloc(stat.size + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > stat.size) return [];
        text = buffer.toString("utf8", 0, bytesRead);
      } finally { await handle.close(); }
      if (text.includes("\0")) return [];
      const matches: ContentHit[] = [];
      const lines = text.split("\n");
      for (let index = 0; index < lines.length && matches.length < 3; index += 1) {
        const line = lines[index]!;
        if (line.toLowerCase().includes(needle)) {
          matches.push({ path: relative, line: index + 1, text: line.trim().slice(0, 160) });
        }
      }
      return matches;
    } catch { return []; } // Files may be renamed while the agent works.
  };
  for (let offset = 0; offset < files.length && hits.length < limit; offset += 4) {
    hits.push(...(await Promise.all(files.slice(offset, offset + 4).map(scan))).flat());
  }
  return hits.slice(0, limit);
}
