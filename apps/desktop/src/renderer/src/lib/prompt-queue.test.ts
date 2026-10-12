import { describe, expect, it } from "vitest";
import { enqueuePrompt, loadQueue, moveQueued, recallablePrompts, removeQueued, saveQueue, takeNext } from "./prompt-queue.js";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    clear: () => map.clear(), key: () => null, length: 0,
  };
}

describe("prompt queue", () => {
  it("keeps follow-ups in order, moves them, and hands out the first", () => {
    let queue = enqueuePrompt([], { content: "first", attachments: [] }).queue;
    queue = enqueuePrompt(queue, { content: "second", attachments: [], skillId: "rev" }).queue;
    queue = enqueuePrompt(queue, { content: "third", attachments: [] }).queue;
    expect(queue.map((item) => item.content)).toEqual(["first", "second", "third"]);
    queue = moveQueued(queue, queue[2]!.id, "up");
    expect(queue.map((item) => item.content)).toEqual(["first", "third", "second"]);
    expect(moveQueued(queue, queue[0]!.id, "up")).toBe(queue);
    const taken = takeNext(queue);
    expect(taken.next?.content).toBe("first");
    expect(taken.queue.map((item) => item.content)).toEqual(["third", "second"]);
    expect(removeQueued(taken.queue, taken.queue[0]!.id).map((item) => item.content)).toEqual(["second"]);
  });

  it("refuses the twenty-first follow-up rather than dropping one silently", () => {
    let queue = Array.from({ length: 20 }, (_, index) => enqueuePrompt([], { content: String(index), attachments: [] }).queue[0]!);
    const result = enqueuePrompt(queue, { content: "too many", attachments: [] });
    expect(result.accepted).toBe(false);
    expect(result.queue).toBe(queue);
    queue = takeNext(queue).queue;
    expect(enqueuePrompt(queue, { content: "fits", attachments: [] }).accepted).toBe(true);
  });

  it("survives a restart through storage and ignores junk", () => {
    const storage = memoryStorage();
    const queue = enqueuePrompt([], { content: "later", attachments: [{ name: "a.png", path: "/tmp/a.png", size: 1 }] }).queue;
    expect(saveQueue(storage, "s1", queue)).toBe(true);
    expect(loadQueue(storage, "s1")).toEqual(queue);
    expect(loadQueue(storage, "s2")).toEqual([]);
    storage.setItem("capsule.queue:s3", JSON.stringify([{ nope: true }, { id: "x", content: "ok", attachments: [], createdAt: "now" }]));
    expect(loadQueue(storage, "s3").map((item) => item.content)).toEqual(["ok"]);
    saveQueue(storage, "s1", []);
    expect(storage.getItem("capsule.queue:s1")).toBeNull();
  });

  it("recalls earlier prompts newest first, skipping steers and repeats", () => {
    const prompts = recallablePrompts([
      { role: "user", content: "one" }, { role: "assistant", content: "reply" }, { role: "user", content: "two" },
      { role: "user", kind: "steer", content: "steer" }, { role: "user", content: "two" }, { role: "user", content: "  " },
    ]);
    expect(prompts).toEqual(["two", "one"]);
  });
});
