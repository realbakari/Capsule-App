import { describe, expect, it, beforeEach } from "vitest";

import { applyAppearance, applyStoredTheme } from "./appearance";

/*
 * These touch the document, which the node environment does not have. A
 * stand-in is enough: the behaviour under test is which attributes end up on
 * the root element.
 */
function stubDocument() {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  (globalThis as { document?: unknown }).document = { documentElement: root };
  (globalThis as { window?: unknown }).window = {
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
    localStorage: undefined,
  };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: () => null,
    setItem: () => {},
  };
  return root;
}

describe("the website's theme", () => {
  let root: ReturnType<typeof stubDocument>;
  beforeEach(() => {
    root = stubDocument();
  });

  it("stays dark once locked, whatever settings arrive afterwards", () => {
    /*
     * The landing page embeds the real app over a demo bridge, and that app
     * loads settings and applies them like any other. Without the lock the
     * site painted dark and went light a second later, when the demo's
     * "follow the system" theme arrived on a light Mac.
     */
    applyStoredTheme("dark");
    expect(root.dataset.theme).toBe("dark");

    applyAppearance({ appearanceTheme: "system" } as never);
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.surface).toBe("dark");
  });

  it("follows the chosen theme again when nothing is forced", () => {
    applyStoredTheme();
    applyAppearance({ appearanceTheme: "light" } as never);
    expect(root.dataset.theme).toBe("light");
  });
});
