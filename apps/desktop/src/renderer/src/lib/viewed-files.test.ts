import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "@capsule/shared";
import { diffFileHash, parseViewedStore, readViewedStore, setViewed, viewedKey, writeViewedStore, VIEWED_STORAGE_KEY } from "./viewed-files";

const patch = (body: string) => parseUnifiedDiff([
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1 +1 @@",
  "-old",
  `+${body}`,
  "",
].join("\n"))[0]!;

describe("viewed marks", () => {
  it("treats a changed diff as unviewed and an identical one as viewed", () => {
    const first = patch("new");
    const store = setViewed({}, "thread", viewedKey(first), true, 1);
    expect(store.thread?.[viewedKey(patch("new"))]).toBe(1);
    expect(store.thread?.[viewedKey(patch("newer"))]).toBeUndefined();
    expect(diffFileHash(first)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps marks per thread and drops a thread with none left", () => {
    const file = patch("new");
    let store = setViewed({}, "one", viewedKey(file), true, 1);
    store = setViewed(store, "two", viewedKey(file), true, 2);
    expect(Object.keys(store)).toEqual(["one", "two"]);
    store = setViewed(store, "one", viewedKey(file), false, 3);
    expect(Object.keys(store)).toEqual(["two"]);
  });

  it("forgets the least recently used threads past the bound", () => {
    let store = {};
    for (let index = 0; index < 45; index += 1) store = setViewed(store, `t${index}`, "k", true, index);
    expect(Object.keys(store)).toHaveLength(40);
    expect(store).not.toHaveProperty("t0");
    expect(store).toHaveProperty("t44");
  });

  it("survives broken, foreign and blocked storage", () => {
    expect(parseViewedStore("{not json")).toEqual({});
    expect(parseViewedStore(JSON.stringify([1]))).toEqual({});
    expect(parseViewedStore(JSON.stringify({ t: { a: 1, b: "x" } }))).toEqual({ t: { a: 1 } });
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); } };
    expect(readViewedStore(throwing)).toEqual({});
    expect(() => writeViewedStore(throwing, { t: { a: 1 } })).not.toThrow();
    const saved = new Map<string, string>();
    writeViewedStore({ setItem: (key, value) => { saved.set(key, value); } }, { t: { a: 1 } });
    expect(readViewedStore({ getItem: (key) => saved.get(key) ?? null })).toEqual({ t: { a: 1 } });
    expect(saved.has(VIEWED_STORAGE_KEY)).toBe(true);
  });
});
