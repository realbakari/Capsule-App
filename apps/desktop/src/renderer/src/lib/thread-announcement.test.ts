import { describe, expect, it } from "vitest";
import { nextThreadAnnouncement, type ThreadActivity, type ThreadAnnouncementMemory } from "./thread-announcement";

function walk(snapshots: ThreadActivity[]): Array<string | undefined> {
  let memory: ThreadAnnouncementMemory | undefined;
  return snapshots.map((snapshot) => {
    const next = nextThreadAnnouncement(memory, snapshot);
    memory = next.memory;
    return next.text;
  });
}

const thread = (run?: ThreadActivity["run"], requests: ThreadActivity["requests"] = [], threadId = "t1"): ThreadActivity => ({ threadId, run, requests });

describe("thread announcements", () => {
  it("says nothing on first look, then names how a watched turn ended", () => {
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "completed" })]))
      .toEqual([undefined, undefined, "Reply finished."]);
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "failed" })])[1]).toBe("The turn failed.");
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "cancelled" })])[1]).toBe("The turn stopped.");
  });

  it("stays quiet for history: a thread opened on a finished turn, or runs that load after it", () => {
    expect(walk([thread({ id: "r1", status: "completed" }), thread({ id: "r1", status: "completed" })])).toEqual([undefined, undefined]);
    expect(walk([thread(), thread({ id: "r1", status: "completed" })])).toEqual([undefined, undefined]);
  });

  it("starts over on another thread instead of reading its state as news", () => {
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r2", status: "completed" }, [], "t2")])).toEqual([undefined, undefined]);
  });

  it("names a request once when it starts waiting, and counts several that arrive together", () => {
    const approval = { id: "a1", question: false, agent: "Codex", action: "run a command" };
    const question = { id: "q1", question: true, agent: "Codex", action: "ask" };
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "approval_required" }, [approval]), thread({ id: "r1", status: "approval_required" }, [approval])]))
      .toEqual([undefined, "Codex needs approval to run a command.", undefined]);
    expect(walk([thread(), thread(undefined, [question])])[1]).toBe("Codex asked a question.");
    expect(walk([thread(), thread(undefined, [approval, question])])[1]).toBe("2 requests are waiting for you.");
  });

  it("speaks an ending and a new request together as one sentence pair", () => {
    const approval = { id: "a2", question: false, agent: "Codex", action: "edit files" };
    expect(walk([thread({ id: "r1", status: "running" }), thread({ id: "r1", status: "completed" }, [approval])])[1])
      .toBe("Reply finished. Codex needs approval to edit files.");
  });
});
