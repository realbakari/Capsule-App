import { describe, expect, it } from "vitest";
import { LongCommandWatch } from "./long-commands.js";

const command = (runId = "run-1") => ({ runId, sessionId: "session-1", title: "pnpm test" });

describe("LongCommandWatch", () => {
  it("reports a command once it reaches the threshold, and only once", () => {
    const watch = new LongCommandWatch();
    watch.start("a", 1_000, command());
    expect(watch.overdue(30_999, 30_000)).toEqual([]);
    expect(watch.overdue(31_000, 30_000)).toEqual([{ ...command(), seconds: 30 }]);
    expect(watch.overdue(90_000, 30_000)).toEqual([]);
  });

  it("does not report a command that finished first", () => {
    const watch = new LongCommandWatch();
    watch.start("a", 0, command());
    watch.finish("a");
    expect(watch.overdue(60_000, 30_000)).toEqual([]);
  });

  it("keeps the first start when the agent repeats an update", () => {
    const watch = new LongCommandWatch();
    watch.start("a", 0, command());
    watch.start("a", 20_000, command());
    expect(watch.overdue(30_000, 30_000)).toHaveLength(1);
  });

  it("drops every command of a run that ended", () => {
    const watch = new LongCommandWatch();
    watch.start("a", 0, command("run-1"));
    watch.start("b", 0, command("run-2"));
    watch.finishRun("run-1");
    expect(watch.overdue(60_000, 30_000).map((item) => item.runId)).toEqual(["run-2"]);
  });
});
