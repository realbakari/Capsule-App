import { describe, expect, it } from "vitest";
import type { RunEvent } from "@capsule/shared";
import {
  activityFromEvents,
  cleanActivityDetail,
  detailAddsSomething,
  extractTouchedFiles,
  summariseWork,
} from "./activity.js";

const event = (streamKind: string, message: string, id: string): RunEvent => ({
  id,
  runId: "run_1",
  timestamp: "2026-08-26T00:00:00.000Z",
  type: streamKind,
  message,
  data: { streamKind },
});

describe("activityFromEvents", () => {
  it("derives phases from the agent's own stream kinds", () => {
    const phases = activityFromEvents(
      [
        event("thinking", "Considering the layout", "1"),
        event("tool", "read_file styles.css", "2"),
        event("message", "Here is the change", "3"),
      ],
      false,
    );
    expect(phases.map((p) => p.label)).toEqual(["Thinking", "Read 1 file", "Writing a reply"]);
  });

  it("folds consecutive frames of one kind into a single row", () => {
    const phases = activityFromEvents(
      [
        event("tool", "read_file a", "1"),
        event("tool", "read_file b", "2"),
        event("tool", "read_file c", "3"),
      ],
      false,
    );
    expect(phases).toHaveLength(1);
    // The row shows the most recent line for that phase.
    expect(phases[0]?.detail).toBe("read_file c");
  });

  it("marks only the final phase active while the run is in flight", () => {
    const phases = activityFromEvents(
      [event("thinking", "a", "1"), event("tool", "b", "2")],
      false,
    );
    expect(phases.map((p) => p.status)).toEqual(["complete", "active"]);
  });

  it("completes every phase once the run has finished", () => {
    const phases = activityFromEvents(
      [event("thinking", "a", "1"), event("tool", "b", "2")],
      true,
    );
    expect(phases.every((p) => p.status === "complete")).toBe(true);
  });

  it("surfaces an error phase as an error", () => {
    const phases = activityFromEvents([event("error", "Authentication required", "1")], true);
    expect(phases[0]?.status).toBe("error");
    expect(phases[0]?.detail).toBe("Authentication required");
  });

  it("ignores lifecycle noise and untagged events", () => {
    const untagged: RunEvent = {
      id: "x", runId: "run_1", timestamp: "t", type: "contract", message: "Contract created",
    };
    expect(activityFromEvents([event("lifecycle", "Run started", "1"), untagged], false)).toEqual([]);
  });

  it("hides or collapses thinking when asked", () => {
    const events = [event("thinking", "Considering the layout", "1"), event("tool", "read", "2")];
    expect(activityFromEvents(events, false, { reasoning: "hidden" }).map((p) => p.label)).toEqual([
      "Read 1 file",
    ]);
    expect(activityFromEvents(events, false, { reasoning: "collapsed" })[0]?.detail).toBeUndefined();
  });

  it("truncates a long detail to one line", () => {
    const phases = activityFromEvents(
      [event("thinking", `${"x".repeat(400)}\nsecond line`, "1")],
      false,
    );
    expect(phases[0]?.detail?.length).toBe(120);
  });
});

describe("activityFromEvents without stream kinds", () => {
  // The mock runtime and older Gateway builds tag only the event type.
  const typed = (type: string, message: string, id: string): RunEvent => ({
    id,
    runId: "run_1",
    timestamp: "2026-08-26T00:00:00.000Z",
    type,
    message,
  });

  it("recovers a kind from the event type", () => {
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file styles.css", "1"),
        typed("tool.completed", "done", "2"),
        typed("assistant", "Here is the change", "3"),
      ],
      false,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Writing a reply"]);
  });

  it("marks the group as failed when a tool call fails", () => {
    // A `.failed` frame closes the call the previous frame opened, exactly as
    // `.completed` does — but it must not be discarded the same way, or a tool
    // that failed is shown as "Read 1 file", complete, with nothing wrong.
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file missing.css", "1"),
        typed("tool.failed", "ENOENT: no such file", "2"),
      ],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]!.status).toBe("error");
  });

  it("keeps a failure visible once the run has moved on", () => {
    const phases = activityFromEvents(
      [
        typed("tool.started", "read_file missing.css", "1"),
        typed("tool.failed", "ENOENT", "2"),
        typed("tool.started", "read_file ok.css", "3"),
        typed("tool.completed", "done", "4"),
      ],
      true,
    );
    expect(phases.some((phase) => phase.status === "error")).toBe(true);
  });

  it("still ignores chrome events", () => {
    const phases = activityFromEvents(
      [typed("lifecycle", "Run started", "1"), typed("approval.requested", "x", "2"), typed("contract", "y", "3")],
      false,
    );
    expect(phases).toEqual([]);
  });
});

describe("work is summarised, not transcribed", () => {
  const ev = (streamKind: string, message: string, id: string): RunEvent => ({
    id, runId: "run_1", timestamp: "2026-08-26T00:00:00.000Z",
    type: streamKind, message, data: { streamKind },
  });

  it("collapses repeated reads into one counted line", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"), ev("tool", "read_file b.ts", "2"),
       ev("tool", "read_file c.ts", "3"), ev("tool", "read_file d.ts", "4")],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]?.label).toBe("Read 4 files");
    expect(phases[0]?.count).toBe(4);
  });

  it("uses the singular for one frame", () => {
    const phases = activityFromEvents([ev("tool", "read_file only.ts", "1")], true);
    expect(phases[0]?.label).toBe("Read 1 file");
  });

  it("counts commands and edits separately from reads", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"),
       ev("command", "ls src/", "2"), ev("command", "rg TODO", "3"),
       ev("patch", "edit styles.css", "4")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Ran 2 commands", "Changed 1 file"]);
  });

  it("falls back to a generic tool count for unrecognised calls", () => {
    const phases = activityFromEvents(
      [ev("tool", "web_search capsule", "1"), ev("tool", "web_search acp", "2")],
      true,
    );
    expect(phases[0]?.label).toBe("Used 2 tools");
  });

  it("starts a new group when the action changes and back again", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a", "1"), ev("command", "ls", "2"), ev("tool", "read_file b", "3")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Read 1 file", "Ran 1 command", "Read 1 file"]);
  });

  it("leaves non-work phases labelled as before", () => {
    const phases = activityFromEvents(
      [ev("thinking", "considering", "1"), ev("message", "drafting", "2")],
      true,
    );
    expect(phases.map((p) => p.label)).toEqual(["Thinking", "Writing a reply"]);
  });
});

describe("full reasoning is kept, not truncated", () => {
  const ev = (streamKind: string, message: string, id: string): RunEvent => ({
    id, runId: "run_1", timestamp: "2026-08-26T00:00:00.000Z",
    type: streamKind, message, data: { streamKind },
  });

  it("joins every reasoning chunk in order", () => {
    const phases = activityFromEvents(
      [ev("thinking", "First I will read the file.", "1"),
       ev("thinking", "Then compare it to the siblings.", "2"),
       ev("thinking", "Then draft the change.", "3")],
      true,
    );
    expect(phases).toHaveLength(1);
    expect(phases[0]?.body).toBe(
      "First I will read the file.\nThen compare it to the siblings.\nThen draft the change.",
    );
  });

  it("keeps the whole thought even when the row detail is truncated", () => {
    const long = "y".repeat(400);
    const phases = activityFromEvents([ev("thinking", long, "1")], true);
    // The one-line row is capped…
    expect(phases[0]?.detail?.length).toBe(120);
    // …but nothing is lost.
    expect(phases[0]?.body).toHaveLength(400);
  });

  it("does not attach a body to non-reasoning phases", () => {
    const phases = activityFromEvents(
      [ev("tool", "read_file a.ts", "1"), ev("command", "ls", "2")],
      true,
    );
    expect(phases.every((p) => p.body === undefined)).toBe(true);
  });
});

describe("summariseWork", () => {
  const phase = (id: string, count: number, label = "x") => ({
    id,
    label,
    count,
    status: "complete" as const,
  });

  it("counts actions, not rows", () => {
    // "Read 12 files" is one phase carrying count 12. Counting phases reports
    // 1 where 12 happened.
    const summary = summariseWork([phase("work:ran", 16), phase("work:read", 12)]);
    expect(summary).toMatchObject({ commands: 16, tools: 12 });
    expect(summary.label).toBe("Ran 16 commands and used 12 tools");
  });

  it("does not count a command as a tool as well", () => {
    const summary = summariseWork([phase("work:ran", 3)]);
    expect(summary.commands).toBe(3);
    expect(summary.tools).toBe(0);
    expect(summary.label).toBe("Ran 3 commands");
  });

  it("ignores reasoning, which is not work the user asked about", () => {
    const summary = summariseWork([phase("thinking", 40), phase("work:read", 2)]);
    expect(summary.tools).toBe(2);
    expect(summary.label).toBe("Used 2 tools");
  });

  it("reads the id, not the display label", () => {
    // A phase retitled to something containing "Ran" must not become a command.
    const summary = summariseWork([phase("work:read", 5, "Ran out of files to read")]);
    expect(summary.commands).toBe(0);
    expect(summary.tools).toBe(5);
  });

  it("uses singular forms for one", () => {
    expect(summariseWork([phase("work:ran", 1), phase("work:read", 1)]).label).toBe(
      "Ran 1 command and used 1 tool",
    );
  });

  it("returns an empty label when nothing happened, so the caller can hide it", () => {
    expect(summariseWork([]).label).toBe("");
    expect(summariseWork([phase("thinking", 9)]).label).toBe("");
  });
});

describe("cleanActivityDetail", () => {
  it("drops the status a frame carries about itself", () => {
    // The row's own glyph says whether it finished; a completed row that reads
    // "pending" contradicts it.
    expect(cleanActivityDetail("Read File (pending)")).toBe("Read File");
    expect(cleanActivityDetail("Terminal (pending)")).toBe("Terminal");
  });

  it("unwraps a tool-call envelope", () => {
    expect(cleanActivityDetail("tool call (completed): ```console commit 5b7d72a")).toBe(
      "commit 5b7d72a",
    );
    expect(cleanActivityDetail("tool_call: read_file src/app.ts")).toBe("read_file src/app.ts");
  });

  it("keeps the command someone would want to read", () => {
    expect(cleanActivityDetail('grep -n "composerTargetKey" apps/web')).toBe(
      'grep -n "composerTargetKey" apps/web',
    );
  });

  it("says nothing rather than something empty", () => {
    expect(cleanActivityDetail(undefined)).toBeUndefined();
    expect(cleanActivityDetail("   ")).toBeUndefined();
    expect(cleanActivityDetail("```")).toBeUndefined();
    expect(cleanActivityDetail("(completed)")).toBeUndefined();
  });

  it("takes the first line only, and bounds it", () => {
    expect(cleanActivityDetail("first line\nsecond line")).toBe("first line");
    expect(cleanActivityDetail("x".repeat(400))?.length).toBe(120);
  });
});

describe("detailAddsSomething", () => {
  it("drops a detail that only repeats the label", () => {
    // "Read 1 file · Read File" is the same row printed twice.
    expect(detailAddsSomething("Read 1 file", "Read File")).toBe(false);
    expect(detailAddsSomething("Ran 3 commands", "command")).toBe(false);
  });

  it("keeps one that names what was touched", () => {
    expect(detailAddsSomething("Read 1 file", "Read src/app.ts (10 - 40)")).toBe(true);
    expect(detailAddsSomething("Ran 1 command", "grep -n foo src")).toBe(true);
  });

  it("has nothing to keep when there is no detail", () => {
    expect(detailAddsSomething("Read 1 file", undefined)).toBe(false);
  });
});

describe("extractTouchedFiles", () => {
  it("extracts created files from tool messages", () => {
    const events: RunEvent[] = [
      event("tool", "create_file capsule.json", "1"),
      event("tool", "read_file package.json", "2"),
    ];
    const touched = extractTouchedFiles(events);
    expect(touched).toHaveLength(2);
    expect(touched.find((f) => f.path === "capsule.json")?.action).toBe("created");
    expect(touched.find((f) => f.path === "package.json")?.action).toBe("read");
  });

  it("extracts files from absolute paths within workspace", () => {
    const events: RunEvent[] = [
      event("tool", "Created /Users/me/project/capsule.json with config", "1"),
    ];
    const touched = extractTouchedFiles(events, undefined, "/Users/me/project");
    expect(touched).toHaveLength(1);
    expect(touched[0]).toMatchObject({
      path: "capsule.json",
      action: "created",
    });
  });

  it("takes git's account of a file the turn touched, and lists no others", () => {
    /*
     * This used to list everything git reported, so one uncommitted file
     * appeared under every reply in the project — including conversations
     * that touched nothing. Git supplies the counts; the turn supplies the
     * list.
     */
    const git = {
      available: true,
      isRepo: true,
      branch: "main",
      dirty: true,
      changed: 2,
      summary: "2 changed",
      branches: ["main"],
      files: [
        { path: "capsule.json", code: "?", added: 12 },
        { path: "src/index.ts", code: "M", added: 4, removed: 1 },
      ],
    };
    expect(extractTouchedFiles([], git)).toEqual([]);

    const touched = extractTouchedFiles([event("tool", "write_file src/index.ts", "1")], git);
    expect(touched).toHaveLength(1);
    expect(touched[0]).toMatchObject({
      path: "src/index.ts",
      action: "modified",
      added: 4,
      removed: 1,
    });
  });

  it("prioritizes created and modified actions over read", () => {
    const events: RunEvent[] = [
      event("tool", "read_file capsule.json", "1"),
      event("tool", "write_file capsule.json", "2"),
    ];
    const touched = extractTouchedFiles(events);
    expect(touched).toHaveLength(1);
    expect(touched[0]?.action).toBe("modified");
  });

  it("extracts structured parameters from toolCall data", () => {
    const structuredEvent: RunEvent = {
      id: "1",
      runId: "run_1",
      timestamp: "2026-08-26T00:00:00.000Z",
      type: "tool",
      message: "write",
      data: {
        toolCall: {
          name: "write_to_file",
          parameters: { targetFile: "src/components/Button.tsx" },
        },
      },
    };
    const touched = extractTouchedFiles([structuredEvent]);
    expect(touched).toHaveLength(1);
    expect(touched[0]?.path).toBe("src/components/Button.tsx");
    expect(touched[0]?.action).toBe("created");
  });

  it("extracts line counts from toolCall code content", () => {
    const structuredEvent: RunEvent = {
      id: "1",
      runId: "run_1",
      timestamp: "2026-08-26T00:00:00.000Z",
      type: "tool",
      message: "write",
      data: {
        toolCall: {
          name: "write_to_file",
          parameters: {
            targetFile: "capsule.json",
            codeContent: "line1\nline2\nline3",
          },
        },
      },
    };
    const touched = extractTouchedFiles([structuredEvent]);
    expect(touched).toHaveLength(1);
    expect(touched[0]?.added).toBe(3);
  });
});

describe("files a turn touched, and only those", () => {
  const gitStatus = {
    available: true,
    isRepo: true,
    branch: "main",
    dirty: true,
    changed: 1,
    summary: "1 changed",
    files: [{ path: "capsule.json", code: "??", added: 17, removed: 0 }],
    branches: ["main"],
  } as never;

  const toolEvent = (title: string): RunEvent => ({
    id: "evt_1",
    runId: "run_1",
    timestamp: new Date().toISOString(),
    type: "tool",
    message: title,
    data: { streamKind: "tool", title },
  });

  it("says nothing about a working tree this turn did not touch", () => {
    /*
     * One uncommitted file put "1 file changed · capsule.json · Restore this
     * turn" under every reply in the project, including conversations that
     * touched nothing at all. Git status describes the whole tree; a turn's
     * card is about the turn.
     */
    expect(extractTouchedFiles([], gitStatus, "/repo")).toEqual([]);
    expect(extractTouchedFiles([toolEvent("Read README.md")], gitStatus, "/repo")).toEqual([
      expect.objectContaining({ path: "README.md", action: "read" }),
    ]);
  });

  it("still takes git's counts for a file the turn did touch", () => {
    // The +17 is worth having; it just cannot be the reason a file is listed.
    const [file] = extractTouchedFiles([toolEvent("write_file capsule.json")], gitStatus, "/repo");
    expect(file).toMatchObject({ path: "capsule.json", action: "created", added: 17, removed: 0 });
  });
});
