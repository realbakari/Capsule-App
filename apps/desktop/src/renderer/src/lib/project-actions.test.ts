import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectAction } from "@capsule/shared";

const actions: ProjectAction[] = [
  { id: "dev", name: "dev", command: "pnpm dev" },
  { id: "test", name: "test", command: "pnpm test" },
];

function stubStorage(store: Map<string, string>, broken = false) {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => { if (broken) throw new Error("denied"); return store.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (broken) throw new Error("denied"); store.set(key, value); },
  });
}

async function fresh() {
  vi.resetModules();
  return import("./project-actions");
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("last project action", () => {
  it("offers the first action until one is run, then the one run last, per project", async () => {
    stubStorage(new Map());
    const { primaryAction, rememberLastAction } = await fresh();
    expect(primaryAction("p1", actions)?.id).toBe("dev");
    rememberLastAction("p1", "test");
    expect(primaryAction("p1", actions)?.id).toBe("test");
    expect(primaryAction("p2", actions)?.id).toBe("dev");
    expect(primaryAction("p1", [])).toBeUndefined();
  });
  it("falls back to the first action once the remembered one is deleted", async () => {
    stubStorage(new Map());
    const { primaryAction, rememberLastAction } = await fresh();
    rememberLastAction("p1", "test");
    expect(primaryAction("p1", actions.filter((action) => action.id !== "test"))?.id).toBe("dev");
  });
  it("keeps the choice across a reload on this device", async () => {
    const store = new Map<string, string>();
    stubStorage(store);
    (await fresh()).rememberLastAction("p1", "test");
    expect((await fresh()).primaryAction("p1", actions)?.id).toBe("test");
  });
  it("still remembers for this window when storage is unavailable", async () => {
    stubStorage(new Map(), true);
    const { primaryAction, rememberLastAction } = await fresh();
    rememberLastAction("p1", "test");
    expect(primaryAction("p1", actions)?.id).toBe("test");
  });
});
