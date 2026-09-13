import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUsageCache,
  collectUsageRecords,
  collectUsageRecordsAsync,
  defaultUsageRoots,
  readUsageSummary,
  readUsageSummaryAsync,
} from "./reader.js";

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
  vi.restoreAllMocks();
  clearUsageCache();
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
    const roots = defaultUsageRoots("/home/x", {});
    expect(roots.claude).toBe(path.join("/home/x", ".claude", "projects"));
    expect(roots.codex).toBe(path.join("/home/x", ".codex", "sessions"));
  });
  it("uses explicit CLI homes and expands a home-relative setting", () => {
    expect(defaultUsageRoots("/home/x", { CODEX_HOME: "/profiles/codex", CLAUDE_CONFIG_DIR: "~/claude work" })).toEqual({
      codex: "/profiles/codex/sessions", claude: "/home/x/claude work/projects",
    });
    expect(defaultUsageRoots("/home/x", { CODEX_HOME: "", CLAUDE_CONFIG_DIR: " " })).toEqual(defaultUsageRoots("/home/x", {}));
    expect(() => defaultUsageRoots("/home/x", { CODEX_HOME: "relative" })).toThrow("absolute path");
  });
  it("finds records stored only in a custom CLI home", async () => {
    const roots = tempRoots();
    const configured = defaultUsageRoots("/unused", { CLAUDE_CONFIG_DIR: roots.claude, CODEX_HOME: roots.codex });
    writeClaude(configured.claude, "a.jsonl", ["custom"]);
    expect((await readUsageSummaryAsync(undefined, configured)).requests).toBe(1);
  });
});

describe("reading transcripts without stopping the world", () => {
  it("retries a split UTF-8 JSON line instead of caching past its unfinished tail", async () => {
    const roots = tempRoots();
    const file = writeClaude(roots.claude, "split.jsonl", ["界-request"]);
    const bytes = fs.readFileSync(file);
    const split = bytes.indexOf(Buffer.from("界")) + 1;
    fs.writeFileSync(file, bytes.subarray(0, split));
    expect(await collectUsageRecordsAsync(roots)).toHaveLength(0);
    fs.appendFileSync(file, bytes.subarray(split));
    expect((await collectUsageRecordsAsync(roots)).map((record) => record.dedupeKey)).toEqual(["界-request"]);
    fs.appendFileSync(file, "\r\n");
    expect(await collectUsageRecordsAsync(roots)).toHaveLength(1);
  });

  it("retains model context across append scans and exact CRLF boundaries", async () => {
    const roots = tempRoots();
    const file = path.join(roots.codex, "context.jsonl");
    const usage = JSON.stringify({ timestamp: "2026-09-01T10:00:00Z", payload: { info: { last_token_usage: { input_tokens: 10, output_tokens: 2 } } } });
    fs.writeFileSync(file, JSON.stringify({ payload: { model: "fixture-model" } }) + "\r\n" + usage + "\r\n");
    expect((await collectUsageRecordsAsync(roots))[0]?.model).toBe("fixture-model");
    fs.appendFileSync(file, usage + "\r\n");
    expect((await collectUsageRecordsAsync(roots)).map((record) => record.model)).toEqual(["fixture-model", "fixture-model"]);
  });

  it("discards cached records when a replacement file grows beyond the old one", async () => {
    const roots = tempRoots();
    const file = writeClaude(roots.claude, "replace.jsonl", ["old"]);
    await collectUsageRecordsAsync(roots);
    fs.renameSync(file, file + ".old");
    writeClaude(roots.claude, "replace.jsonl", ["new-one", "new-two"]);
    expect((await collectUsageRecordsAsync(roots)).map((record) => record.dedupeKey)).toEqual(["new-one", "new-two"]);
  });
  it("distinguishes missing directories from unreadable sources and preserves usable totals", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", ["m1"]);
    const readdir = fsp.readdir.bind(fsp);
    vi.spyOn(fsp, "readdir").mockImplementation(((dir: string, options: never) => {
      if (dir === roots.codex) return Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }));
      return readdir(dir, options);
    }) as typeof fsp.readdir);
    const summary = await readUsageSummaryAsync(undefined, roots);
    expect(summary.requests).toBe(1);
    expect(summary.unavailableSources).toEqual(["codex"]);
    vi.restoreAllMocks();
    fs.rmdirSync(roots.codex);
    expect((await readUsageSummaryAsync(undefined, roots)).unavailableSources).toEqual([]);
  });

  it("reports failed file reads and retries them instead of caching an empty success", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", ["m1"]);
    vi.spyOn(fsp, "open").mockRejectedValue(Object.assign(new Error("unreadable"), { code: "EACCES" }));
    const failed = await readUsageSummaryAsync(undefined, roots);
    expect(failed.requests).toBe(0);
    expect(failed.unavailableSources).toEqual(["claude"]);
    vi.restoreAllMocks();
    const recovered = await readUsageSummaryAsync(undefined, roots);
    expect(recovered.requests).toBe(1);
    expect(recovered.unavailableSources).toEqual([]);
  });
  it("does not resume another provider's cache when transcript roots overlap", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "shared.jsonl", ["m1"]);
    const records = await collectUsageRecordsAsync({ claude: roots.claude, codex: roots.claude });
    expect(records).toHaveLength(1);
    expect(records[0]?.provider).toBe("claude");
  });
  it("counts the same records as the synchronous reader", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", ["m1", "m2"]);
    clearUsageCache();
    const async = await collectUsageRecordsAsync(roots);
    expect(async.map((record) => record.dedupeKey)).toEqual(
      collectUsageRecords(roots).map((record) => record.dedupeKey),
    );
  });

  it("reads only what was appended since the last look", async () => {
    /*
     * A transcript for a session still in use grows every turn, so a cache
     * that asks "has this file changed" misses it every time and re-reads the
     * whole file — which for the 902MB rollouts on a real machine is where
     * the seconds went. These are append-only: the bytes already read cannot
     * have changed, so only the tail is new.
     */
    const roots = tempRoots();
    const file = writeClaude(roots.claude, "a.jsonl", ["m1", "m2"]);
    clearUsageCache();
    expect(await collectUsageRecordsAsync(roots)).toHaveLength(2);

    fs.appendFileSync(
      file,
      `\n${JSON.stringify({
        timestamp: "2026-09-01T11:00:00.000Z",
        sessionId: "s1",
        message: { id: "m3", model: "claude-opus-5", usage: { input_tokens: 1, output_tokens: 1 } },
      })}`,
    );

    const after = await collectUsageRecordsAsync(roots);
    expect(after.map((record) => record.dedupeKey)).toEqual(["m1", "m2", "m3"]);
  });

  it("reads a rewritten transcript from the start rather than trusting an offset into it", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", ["m1", "m2", "m3"]);
    clearUsageCache();
    expect(await collectUsageRecordsAsync(roots)).toHaveLength(3);

    // Shorter than what was already read: rotated, so the old records are not
    // this file's any more.
    writeClaude(roots.claude, "a.jsonl", ["m9"]);
    expect((await collectUsageRecordsAsync(roots)).map((r) => r.dedupeKey)).toEqual(["m9"]);
  });

  it("leaves the event loop free while it reads", async () => {
    const roots = tempRoots();
    writeClaude(roots.claude, "a.jsonl", Array.from({ length: 400 }, (_, i) => `m${i}`));
    writeClaude(roots.claude, "b.jsonl", Array.from({ length: 400 }, (_, i) => `n${i}`));
    clearUsageCache();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await collectUsageRecordsAsync(roots);
    clearInterval(timer);
    // The synchronous reader serves none of these: it holds the thread from
    // the first file to the last, and on Electron that thread draws the window.
    expect(ticks).toBeGreaterThan(0);
  });
});
