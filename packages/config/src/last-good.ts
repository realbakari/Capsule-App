import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "@capsule/filesystem";

/**
 * The last parse of each settings file that succeeded, kept outside the file.
 * A file broken while Capsule was closed still loads its last good value on
 * the next launch, instead of falling back to defaults the user never chose.
 */
export class LastGoodStore {
  private readonly written = new Map<string, string>();

  constructor(private readonly dir: string) {}

  read(source: string): unknown {
    try {
      const stored = JSON.parse(readFileSync(this.fileFor(source), "utf8")) as { source?: string; value?: unknown };
      return stored.source === source ? stored.value : undefined;
    } catch {
      return undefined;
    }
  }

  remember(source: string, value: unknown): void {
    const text = JSON.stringify({ source, value });
    if (this.written.get(source) === text) return;
    try {
      writeFileAtomic(this.fileFor(source), text);
      this.written.set(source, text);
    } catch {
      // A copy we cannot write only matters if the file later breaks.
    }
  }

  private fileFor(source: string): string {
    return path.join(this.dir, `${createHash("sha1").update(source).digest("hex")}.json`);
  }
}
