import { expect, it } from "vitest";
import { DraftRecovery } from "./draft-recovery";

it("restores the latest failed write, retries persistence and clears accepted text", () => {
  const rows = new Map<string, string>();
  let fail = false;
  const storage = { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { if (fail) throw new Error("Quota"); rows.set(key, value); },
    removeItem: (key: string) => { if (fail) throw new Error("Quota"); rows.delete(key); } };
  const recovery = new DraftRecovery();
  const draft = (prompt: string) => ({ prompt, attachments: [] });
  recovery.save(storage, "one", draft("old")); fail = true;
  expect(recovery.save(storage, "one", draft("new"))).toBe("temporary");
  recovery.save(storage, "two", draft("other"));
  expect(recovery.read(storage, "one").prompt).toBe("new");
  fail = false;
  expect(recovery.save(storage, "one", recovery.read(storage, "one"))).toBe("saved");
  expect(new DraftRecovery().read(storage, "one").prompt).toBe("new");
  fail = true;
  recovery.save(storage, "one", draft(""));
  expect(recovery.read(storage, "one").prompt).toBe("");
});

it("refuses overflow without evicting an existing unsaved draft", () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error("Quota"); }, removeItem: () => {} };
  const recovery = new DraftRecovery();
  for (let index = 0; index < 32; index++) recovery.save(storage, String(index), { prompt: "keep", attachments: [] });
  expect(recovery.save(storage, "overflow", { prompt: "new", attachments: [] })).toBe("full");
  expect(recovery.read(storage, "0").prompt).toBe("keep");
});
