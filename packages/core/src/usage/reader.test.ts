import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectUsageRecords, defaultUsageRoots, readUsageSummary } from "./reader.js";

const made: string[] = [];

function tempRoots() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-usage-"));
  made.push(base);
  const roots = { claude: path.join(base, "claude"), codex: path.join(base, "codex") };
  fs.mkdirSync(roots.claude, { recursive: true });
  fs.mkdirSync(roots.codex, { recursive: true });
  return roots;
}

function writeClaude(dir: string, name: string, ids: string[], mtime?: Date) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    ids
      .map((id) =>
        JSON.stringify({
          timestamp: "2026-09-01T10:00:00.000Z",
          sessionId: "s1",
          message: { id, model: "claude-opus-5", usage: { input_tokens: 10, output_tokens: 5 } },
        }),
      )
      .join("\n"),
  );
  if (mtime) fs.utimesSync(file, mtime, mtime);
  return file;
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("collectUsageRecords", () => {
  it("walks nested directories", () => {
    const roots = tempRoots();
    writeClaude(roots.claude, path.join("project-a", "deep", "one.jsonl"), ["m1"]);
    writeClaude(roots.claude, path.join("project-b", "two.jsonl"), ["m2"]);
    expect(collectUsageRecords(roots)).toHaveLength(2);
  });

  it("ignores files that are not transcripts", () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "one.jsonl", ["m1"]);
    fs.writeFileSync(path.join(roots.claude, "notes.txt"), "not a transcript");
    expect(collectUsageRecords(roots)).toHaveLength(1);
  });

  it("treats a provider that was never installed as no data, not an error", () => {
    const roots = { claude: "/nope/claude", codex: "/nope/codex" };
    expect(collectUsageRecords(roots)).toEqual([]);
  });

  it("skips a transcript last written before the window", () => {
    const roots = tempRoots();
    const old = new Date("2020-01-01T00:00:00Z");
    writeClaude(roots.claude, "old.jsonl", ["m-old"], old);
    writeClaude(roots.claude, "new.jsonl", ["m-new"]);
    const records = collectUsageRecords(roots, Date.parse("2026-01-01T00:00:00Z"));
    expect(records.map((record) => record.dedupeKey)).toEqual(["m-new"]);
  });

  it("names a Codex session after its file when the lines do not", () => {
    const roots = tempRoots();
    fs.writeFileSync(
      path.join(roots.codex, "rollout-abc.jsonl"),
      JSON.stringify({
        timestamp: "2026-09-01T10:00:00.000Z",
        payload: { info: { model: "gpt-5.6", last_token_usage: { input_tokens: 10, output_tokens: 4 } } },
      }),
    );
    expect(collectUsageRecords(roots)[0]?.sessionId).toBe("rollout-abc");
  });
});

describe("readUsageSummary", () => {
  it("de-duplicates across files, not just within one", () => {
    // The same assistant message can appear in two transcripts; counting it
    // twice is the whole failure mode this guards.
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", ["shared"]);
    writeClaude(roots.claude, "b.jsonl", ["shared"]);
    const summary = readUsageSummary(undefined, roots);
    expect(summary.requests).toBe(1);
    expect(summary.totals.input).toBe(10);
  });

  it("returns an empty summary when there is nothing to read", () => {
    expect(readUsageSummary(undefined, tempRoots()).requests).toBe(0);
  });
});

describe("defaultUsageRoots", () => {
  it("points at where the CLIs actually write", () => {
    const roots = defaultUsageRoots("/home/x");
    expect(roots.claude).toBe(path.join("/home/x", ".claude", "projects"));
    expect(roots.codex).toBe(path.join("/home/x", ".codex", "sessions"));
  });
});
