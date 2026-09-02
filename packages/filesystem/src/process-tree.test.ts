import { describe, expect, it } from "vitest";

import { parseElapsedSeconds, parsePsTable, selectAgentPids } from "./process-tree.js";

const TABLE = [
  "    1     0   0.0   3536 02-01:07:39 /sbin/launchd",
  "  663     1   0.3  67872 02-01:04:51 /Applications/Claude.app/Contents/MacOS/Claude",
  "  888   663   0.1  20736    01:00:44 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
  " 4210     1  12.5 251904       04:12 /opt/homebrew/bin/openclaw",
  " 4288  4210  87.2 903168       02:07 /opt/homebrew/bin/claude",
  " 4290  4288   3.0  10240       02:07 /usr/bin/rg",
].join("\n");

describe("parseElapsedSeconds", () => {
  it("reads every shape ps prints", () => {
    expect(parseElapsedSeconds("02:07")).toBe(127);
    expect(parseElapsedSeconds("01:00:44")).toBe(3644);
    expect(parseElapsedSeconds("02-01:07:39")).toBe(176_859);
  });

  it("does not guess at an unparsable value", () => {
    expect(parseElapsedSeconds("-")).toBe(0);
  });
});

describe("parsePsTable", () => {
  it("keeps a command that contains spaces whole", () => {
    const rows = parsePsTable(TABLE);
    const helper = rows.find((row) => row.pid === 888);
    expect(helper?.command).toBe(
      "/Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper",
    );
    expect(helper?.name).toBe("Claude Helper");
  });

  it("reports resident size in bytes, not kilobytes", () => {
    expect(parsePsTable(TABLE).find((row) => row.pid === 4288)?.residentBytes).toBe(903_168 * 1024);
  });
});

describe("selectAgentPids", () => {
  const binaries = new Set(["claude", "codex", "openclaw"]);

  it("takes the agent and everything it spawned", () => {
    const pids = selectAgentPids(parsePsTable(TABLE), binaries);
    // openclaw, the claude CLI under it, and the ripgrep that CLI started.
    expect([...pids].sort((a, b) => a - b)).toEqual([4210, 4288, 4290]);
  });

  it("does not mistake the desktop app for the CLI", () => {
    // /Applications/Claude.app/…/Claude is a chat window in the Dock. A loose
    // match on the name would report it, and its helpers, as agent work.
    const pids = selectAgentPids(parsePsTable(TABLE), binaries);
    expect(pids.has(663)).toBe(false);
    expect(pids.has(888)).toBe(false);
  });

  it("returns nothing when no agent is running", () => {
    expect(selectAgentPids(parsePsTable(TABLE), new Set(["kimi"])).size).toBe(0);
  });
});
