import { describe, expect, it, vi } from "vitest";
import { ChannelDrafts } from "./channel-drafts";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("channel send ownership", () => {
  it("rejects duplicate sends even when a new composer reads the same draft", async () => {
    const drafts = new ChannelDrafts();
    drafts.edit("room:main", { content: "Hello" });
    const request = deferred();
    const post = vi.fn(() => request.promise);
    const sent = drafts.send("room:main", post, String);
    expect(drafts.get("room:main").pending).toBe(true);
    expect(await drafts.send("room:main", post, String)).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    request.resolve();
    expect(await sent).toBe(true);
    expect(drafts.get("room:main")).toMatchObject({ pending: false, content: "", mentions: [] });
  });

  it("does not clear edits made after the submitted revision", async () => {
    const drafts = new ChannelDrafts();
    drafts.edit("room:root", { content: "First" });
    const request = deferred();
    const sent = drafts.send("room:root", () => request.promise, String);
    drafts.edit("room:root", { content: "Newer draft" });
    request.resolve();
    await sent;
    expect(drafts.get("room:root")).toMatchObject({ content: "Newer draft", pending: false });
  });

  it("preserves failed sends and notifies a remounted subscriber", async () => {
    const drafts = new ChannelDrafts();
    drafts.edit("room:main", { content: "Retry later" });
    const request = deferred();
    const sent = drafts.send("room:main", () => request.promise, String);
    const changed = vi.fn();
    const unsubscribe = drafts.subscribe(changed);
    request.reject(new Error("Rejected"));
    expect(await sent).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
    expect(drafts.get("room:main")).toMatchObject({ pending: false, content: "Retry later", error: "Error: Rejected" });
    unsubscribe();
  });

  it("keeps channel and thread admission independent with stable snapshots", async () => {
    const drafts = new ChannelDrafts();
    expect(drafts.get("room:main")).toBe(drafts.get("room:main"));
    drafts.edit("room:main", { content: "Main" });
    drafts.edit("room:root", { content: "Reply" });
    const request = deferred();
    const sent = drafts.send("room:main", () => request.promise, String);
    expect(await drafts.send("room:root", async () => {}, String)).toBe(true);
    expect(drafts.get("room:main").pending).toBe(true);
    request.resolve(); await sent;
  });
});
