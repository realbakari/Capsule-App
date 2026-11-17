import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import { turnsFromMessages } from "../../lib/turns";
import { minimapView, turnMinimap, type RowBox } from "./turn-minimap";

let clock = 0;
const message = (id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
  ({ id, sessionId: "s", role, content, createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, clock++)).toISOString(), ...extra });

const thread = [
  message("intro", "assistant", "Imported from an earlier session."),
  message("p1", "user", "Fix the   login\nform"),
  message("r1a", "assistant", "Looking at it."),
  message("r1b", "assistant", "Fixed: the **submit** handler."),
  message("s1", "user", "also check email", { kind: "steer" }),
  message("p2", "user", "/compact"),
  message("r2", "assistant", "Context compacted."),
  message("p3", "user", "", { attachments: [{ name: "crash.png", path: "/tmp/crash.png", size: 1 }] }),
  message("p4", "user", "Ship it"),
];
const model = turnMinimap(turnsFromMessages(thread));

describe("turnMinimap", () => {
  it("ticks each prompt that opens a turn, not steers, compactions or a reply-only opening", () => {
    expect(model.items.map((item) => [item.number, item.messageId])).toEqual([[1, "p1"], [2, "p3"], [3, "p4"]]);
  });

  it("previews the prompt on one line with the turn's last reply", () => {
    expect(model.items[0]).toMatchObject({ prompt: "Fix the login form", reply: "Fixed: the **submit** handler." });
    expect(model.items[2]?.reply).toBeUndefined();
  });

  it("names an attachment-only prompt by its file", () => {
    expect(model.items[1]?.prompt).toBe("Attached crash.png");
  });

  it("counts a compaction as part of the turn before it, and the opening before any prompt as no turn", () => {
    expect(model.tickOf.get("p2")).toBe(0);
    expect(model.tickOf.has("intro")).toBe(false);
  });
});

describe("minimapView", () => {
  const rows = (...boxes: Array<[string, number, number]>): RowBox[] => boxes.map(([turnId, top, bottom]) => ({ turnId, top, bottom }));

  it("lights every turn on screen, a compaction lighting the turn it belongs to", () => {
    expect(minimapView(model, rows(["intro", -900, -500], ["p1", -500, -100], ["p2", -100, 40], ["p3", 40, 400], ["p4", 400, 900]), 600).inView).toEqual([0, 1, 2]);
  });

  it("makes a jumped-to turn current once it lands below the read line", () => {
    expect(minimapView(model, rows(["p1", -400, 48], ["p2", 48, 60], ["p3", 60, 700]), 600).current).toBe(1);
    expect(minimapView(model, rows(["p1", -400, 48], ["p3", 48, 700]), 600).current).toBe(1);
  });

  it("keeps the turn being read current while no prompt starts on screen", () => {
    expect(minimapView(model, rows(["p1", -2000, 1000]), 600).current).toBe(0);
    expect(minimapView(model, rows(["p1", -2000, 10], ["p2", 10, 1000]), 600).current).toBe(0);
  });

  it("knows no current turn when nothing is mounted", () => {
    expect(minimapView(model, [], 600)).toEqual({ inView: [], current: null });
  });
});
