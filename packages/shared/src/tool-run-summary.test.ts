import { describe, expect, it } from "vitest";
import { summarizeToolRun, type ToolKind, type ToolRunStep } from "./tool-run-summary.js";

const step = (kind: ToolKind, locations?: string[], status = "completed"): ToolRunStep => ({ kind, status, ...(locations ? { details: { locations } } : {}) });

describe("summarizeToolRun", () => {
  it("says a mixed run in the order the work happened", () => {
    expect(summarizeToolRun([
      step("read", ["a.ts", "b.ts"]), step("read", ["c.ts"]), step("execute"),
      step("edit", ["a.ts"]), step("read", ["d.ts", "e.ts", "f.ts"]), step("execute"), step("edit", ["b.ts", "g.ts"]),
    ])).toBe("Read 6 files, ran 2 commands, edited 3 files");
  });

  it("counts a file read twice once, and a read with no reported path as one file", () => {
    expect(summarizeToolRun([step("read", ["a.ts"]), step("read", ["a.ts"]), step("read")])).toBe("Read 2 files");
  });

  it("keeps failures beside the kind of work that failed", () => {
    expect(summarizeToolRun([step("execute"), step("execute", undefined, "failed"), step("edit", ["a.ts"])]))
      .toBe("Ran 2 commands (1 failed), edited 1 file");
    expect(summarizeToolRun([step("edit", ["a.ts"], "failed")])).toBe("Edited 1 file (1 failed)");
  });

  it("phrases every kind in the singular and plural", () => {
    expect(summarizeToolRun([step("search")])).toBe("Searched once");
    expect(summarizeToolRun([step("search"), step("search")])).toBe("Searched 2 times");
    expect(summarizeToolRun([step("fetch"), step("todo"), step("other"), step("other")])).toBe("Fetched 1 page, updated the plan, used 2 tools");
    expect(summarizeToolRun([step("delete", ["x"]), step("move", ["y"]), step("think"), step("switch_mode")]))
      .toBe("Deleted 1 file, moved 1 file, thought it through, switched mode");
  });

  it("says nothing for no work", () => {
    expect(summarizeToolRun([])).toBe("");
  });
});
