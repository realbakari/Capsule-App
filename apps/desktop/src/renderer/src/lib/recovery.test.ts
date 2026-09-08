import { describe, expect, it, vi } from "vitest";
import { DirectoryListings } from "./directory-listings";
import { FileDraftStore } from "./file-drafts";
import { SteeringDrafts } from "./steering-drafts";
import { recoverFailedPrompt } from "./prompt-stash";

describe("user-owned recovery", () => {
  it("keeps failed submissions in memory when durable storage is unavailable", () => {
    const storage = { getItem: () => null, removeItem: () => {}, setItem: () => { throw new Error("quota"); } };
    const result = recoverFailedPrompt(storage, [], { prompt: "keep this", attachments: [] });
    expect(result.persisted).toBe(false);
    expect(result.entries[0]).toMatchObject({ prompt: "keep this", temporary: true });
  });

  it("preserves newer steering and admits only one request per thread", () => {
    const drafts = new SteeringDrafts();
    drafts.edit("A", "first");
    const sent = drafts.begin("A")!;
    expect(drafts.begin("A")).toBeUndefined();
    drafts.edit("A", "newer");
    drafts.edit("B", "other thread");
    sent.finish(true);
    expect(drafts.get("A").text).toBe("newer");
    expect(drafts.get("B").text).toBe("other thread");
    drafts.begin("A")!.finish(false);
    expect(drafts.get("A").text).toBe("newer");
    drafts.begin("A")!.finish(true);
    expect(drafts.get("A").text).toBe("");
  });

  it("retains conflicting drafts without evicting dirty text at its limit", () => {
    const drafts = new FileDraftStore(1, 20);
    const owner = { projectId: "p", root: "/one", path: "a.ts" };
    expect(drafts.change(owner, "old", "rev1")).toBe(true);
    drafts.failed(owner, true);
    expect(drafts.get(owner)?.state).toBe("conflict");
    expect(drafts.change({ ...owner, root: "/two" }, "other", "rev1")).toBe(false);
    drafts.change(owner, "new", "rev1");
    drafts.saved(owner, "old", "rev2");
    expect(drafts.get(owner)).toMatchObject({ contents: "new", revision: "rev2" });
    drafts.saved(owner, "new", "rev3");
    expect(drafts.list()).toHaveLength(0);
  });

  it("distinguishes a failed directory read from empty and retries", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce([]);
    const directories = new DirectoryListings(read);
    await directories.load("src");
    expect(directories.getSnapshot().src).toMatchObject({ error: "offline", entries: undefined });
    await directories.load("src");
    expect(directories.getSnapshot().src).toEqual({ entries: [], loading: false });
  });

  it("refreshes an already loaded folder and isolates old workspace completions", async () => {
    let finish!: (value: never[]) => void;
    const old = new DirectoryListings(() => new Promise((resolve) => { finish = resolve; }));
    const current = new DirectoryListings(async () => [{ name: "new.ts", path: "src/new.ts", type: "file" }]);
    const pending = old.load("src");
    await current.load("src");
    finish([]); await pending;
    expect(current.getSnapshot().src?.entries?.[0]?.name).toBe("new.ts");
  });
});
