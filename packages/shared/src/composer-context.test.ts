import { describe, expect, it } from "vitest";
import {
  CONTEXT_SOURCES,
  commandOutput,
  contextFileName,
  detectCheckCommand,
  diffToMarkdown,
  initPrompt,
  lineRange,
  mentionSources,
  parseBangCommand,
  resolvedContext,
  selectionToMarkdown,
  threadToMarkdown,
} from "./composer-context.js";
import { clipText } from "./text-budget.js";
import type { ChatMessage } from "./types.js";

const message = (role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `${role}-${content.slice(0, 12)}-${extra.runId ?? ""}`, sessionId: "s", role, content, createdAt: "2026-01-01T00:00:00Z", ...extra,
});

describe("context source registry", () => {
  it("offers each kind once and names what it touches", () => {
    expect(new Set(CONTEXT_SOURCES.map((source) => source.kind)).size).toBe(CONTEXT_SOURCES.length);
    expect(CONTEXT_SOURCES.find((source) => source.kind === "url")?.effect).toBe("network");
    expect(CONTEXT_SOURCES.find((source) => source.kind === "diagnostics")?.effect).toBe("command");
  });

  it("matches @ keywords by prefix and leaves off sources @ does not offer", () => {
    expect(mentionSources("").map((source) => source.keyword)).toEqual(["thread", "diff", "diagnostics", "url"]);
    expect(mentionSources("di").map((source) => source.keyword)).toEqual(["diff", "diagnostics"]);
    expect(mentionSources("selection")).toEqual([]);
    expect(mentionSources("src/app")).toEqual([]);
  });

  it("caps attached text and keeps a short excerpt for the chip", () => {
    const resolved = resolvedContext("url", "example.com", "x".repeat(400 * 1024));
    expect(new TextEncoder().encode(resolved.text).length).toBeLessThanOrEqual(200 * 1024);
    expect(resolved.context.excerpt.length).toBeLessThan(2_000);
    expect(resolved.fileName).toBe("Web page - example.com.md");
  });

  it("makes file names safe on disk", () => {
    expect(contextFileName("thread", "Fix a/b: \"login\"")).toBe("Conversation - Fix a b login.md");
  });
});

describe("threadToMarkdown", () => {
  it("keeps prompts and each run's final reply, not the narration before it", () => {
    const markdown = threadToMarkdown({ title: "Fix login", project: "web" }, [
      message("user", "Why does login fail?", { runId: "r1" }),
      message("assistant", "Looking at the handler now", { runId: "r1" }),
      message("assistant", "The token expiry check is inverted.", { runId: "r1" }),
      message("system", "Agent switched"),
      message("user", "Use the clock helper", { runId: "r1", kind: "steer" }),
    ]);
    expect(markdown).toContain("# Fix login");
    expect(markdown).toContain("Project: web");
    expect(markdown).toContain("## Prompt\n\nWhy does login fail?");
    expect(markdown).toContain("## Reply\n\nThe token expiry check is inverted.");
    expect(markdown).toContain("## Steer\n\nUse the clock helper");
    expect(markdown).not.toContain("Looking at the handler");
    expect(markdown).not.toContain("Agent switched");
  });

  it("drops the oldest turns first and says how many it left out", () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(index % 2 ? "assistant" : "user", `${index} ${"word ".repeat(60)}`, { runId: `r${Math.floor(index / 2)}` }));
    const markdown = threadToMarkdown({ title: "Long" }, messages, 4_000);
    expect(new TextEncoder().encode(markdown).length).toBeLessThanOrEqual(4_000);
    expect(markdown).toMatch(/_\d+ earlier messages left out to fit\._/u);
    expect(markdown).toContain("39 word");
    expect(markdown).not.toContain("\n\n0 word");
  });

  it("names a reply's attachments without inlining them", () => {
    const markdown = threadToMarkdown({ title: "T" }, [message("user", "See this", { attachments: [{ name: "spec.md", path: "/tmp/spec.md", size: 3 }] })]);
    expect(markdown).toContain("_Attached: spec.md_");
  });
});

describe("selections and diffs", () => {
  it("quotes a file selection with its path and line range", () => {
    const markdown = selectionToMarkdown({ origin: "file", text: "const a = 1;\n", path: "src/a.ts", startLine: 4, endLine: 6, language: "ts" });
    expect(markdown).toContain("Selected from `src/a.ts:4-6`");
    expect(markdown).toContain("```ts\nconst a = 1;\n```");
  });

  it("quotes browser text with the page it came from", () => {
    const markdown = selectionToMarkdown({ origin: "browser", text: "Hello\nWorld", url: "https://example.com/a", title: "Example" });
    expect(markdown).toContain("Source: https://example.com/a");
    expect(markdown).toContain("> Hello\n> World");
  });

  it("finds 1-based line ranges, not counting a trailing newline as a line", () => {
    const text = "one\ntwo\nthree\nfour";
    expect(lineRange(text, 4, 7)).toEqual({ startLine: 2, endLine: 2 });
    expect(lineRange(text, 4, 8)).toEqual({ startLine: 2, endLine: 2 });
    expect(lineRange(text, 0, text.length)).toEqual({ startLine: 1, endLine: 4 });
  });

  it("fences a diff and says when it was cut", () => {
    expect(diffToMarkdown({ scope: "branch", base: "main", patch: "diff --git a/x b/x\n" })).toContain("# Branch diff against main\n\n```diff\ndiff --git a/x b/x\n```");
    expect(diffToMarkdown({ scope: "uncommitted", patch: "+".repeat(300 * 1024) })).toContain("cut to fit");
  });
});

describe("! commands", () => {
  it("reads a command only from the very start of the draft", () => {
    expect(parseBangCommand("!ls -la")).toBe("ls -la");
    expect(parseBangCommand("!  git status  ")).toBe("git status");
    expect(parseBangCommand("!")).toBeUndefined();
    expect(parseBangCommand(" !ls")).toBeUndefined();
    expect(parseBangCommand("please run !ls")).toBeUndefined();
  });

  it("keeps the end of long output, where errors are", () => {
    const { output, truncated } = commandOutput(`${"ok\n".repeat(50_000)}`, "error: boom", 1_024);
    expect(truncated).toBe(true);
    expect(output.endsWith("error: boom")).toBe(true);
  });

  it("never splits a character when clipping", () => {
    expect(clipText("é".repeat(10), 5, "head")).toEqual({ text: "éé", truncated: true });
    expect(clipText("é".repeat(10), 5, "tail")).toEqual({ text: "éé", truncated: true });
  });
});

describe("detectCheckCommand", () => {
  it("prefers an action marked as the check", () => {
    expect(detectCheckCommand({
      actions: [{ id: "a", name: "Dev", command: "pnpm dev" }, { id: "b", name: "Verify", command: "make verify", check: true }],
      packageJson: JSON.stringify({ scripts: { typecheck: "tsc" } }),
    })).toEqual({ command: "make verify", source: "action", name: "Verify" });
  });

  it("falls back to typecheck, then lint, run by the project's package manager", () => {
    expect(detectCheckCommand({ packageJson: JSON.stringify({ scripts: { lint: "eslint .", typecheck: "tsc" } }), lockfiles: ["pnpm-lock.yaml"] }))
      .toEqual({ command: "pnpm run typecheck", source: "script", name: "typecheck" });
    expect(detectCheckCommand({ packageJson: JSON.stringify({ scripts: { lint: "eslint ." } }) }))
      .toEqual({ command: "npm run lint", source: "script", name: "lint" });
  });

  it("finds nothing rather than guessing", () => {
    expect(detectCheckCommand({ packageJson: JSON.stringify({ scripts: { test: "vitest", dev: "vite" } }) })).toBeUndefined();
    expect(detectCheckCommand({ packageJson: "{not json" })).toBeUndefined();
    expect(detectCheckCommand({})).toBeUndefined();
  });
});

describe("initPrompt", () => {
  it("names the instruction files that already exist", () => {
    expect(initPrompt(["AGENTS.md", "CLAUDE.md"])).toContain("This project already has `AGENTS.md`, `CLAUDE.md`.");
    expect(initPrompt([])).toContain("no agent instruction file yet");
  });
});
