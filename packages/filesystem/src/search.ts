import fs from "node:fs";
import path from "node:path";
import type { ContentHit } from "@capsule/shared";

const SKIP = new Set(["node_modules", ".git", "dist", "out", ".next", "coverage", "build", "Pods"]);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|woff2?|ttf|mp4|mov|dylib|so|o)$/i;

export function searchContents(projectRoot: string | undefined, query: string, limit = 60): ContentHit[] {
  const needle = query.trim().toLowerCase();
  if (!projectRoot || !needle || !fs.existsSync(projectRoot)) return [];
  const hits: ContentHit[] = [];
  const walk = (dir: string, relative: string, depth: number) => {
    if (hits.length >= limit || depth > 6) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (hits.length >= limit) return;
      if (SKIP.has(entry.name) || entry.name === ".DS_Store") continue;
      if (entry.name.startsWith(".") && entry.name !== ".env" && entry.name !== ".gitignore") continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel, depth + 1);
        continue;
      }
      if (BINARY.test(entry.name)) continue;
      let text = "";
      try {
        const stat = fs.statSync(full);
        if (stat.size > 400_000) continue;
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      const lines = text.split(/\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (hits.length >= limit) return;
        const line = lines[index] ?? "";
        if (!line.toLowerCase().includes(needle)) continue;
        hits.push({
          path: rel,
          line: index + 1,
          text: line.trim().slice(0, 160),
        });
        if (hits.filter((item) => item.path === rel).length >= 3) break;
      }
    }
  };
  walk(projectRoot, "", 0);
  return hits;
}
