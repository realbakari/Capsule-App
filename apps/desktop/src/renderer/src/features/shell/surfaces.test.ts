import { describe, expect, it } from "vitest";
import { SURFACES } from "./Inspector.js";

const reasons = (state: { projectId?: string; git?: { isRepo?: boolean } }) =>
  Object.fromEntries(SURFACES.map((s) => [s.tool, s.blockedBy(state)]));

describe("inspector surfaces", () => {
  it("blocks what needs a project, naming why", () => {
    const blocked = reasons({});
    expect(blocked.terminal).toBe("Open a project first.");
    expect(blocked.files).toBe("Open a project first.");
  });

  it("blocks review outside a Git repository", () => {
    expect(reasons({ projectId: "p1", git: { isRepo: false } }).review).toBe(
      "Available for Git repositories.",
    );
  });

  it("opens everything once there is a project and a repository", () => {
    const blocked = reasons({ projectId: "p1", git: { isRepo: true } });
    expect(Object.values(blocked).every((reason) => reason === undefined)).toBe(true);
  });

  it("keeps the surfaces that need neither always available", () => {
    const blocked = reasons({});
    // A browser and a side chat do not depend on a folder being open.
    expect(blocked.browser).toBeUndefined();
    expect(blocked.chat).toBeUndefined();
  });

  it("gives every surface a label and a description", () => {
    for (const surface of SURFACES) {
      expect(surface.label.length, surface.tool).toBeGreaterThan(0);
      expect(surface.detail.endsWith("."), surface.tool).toBe(true);
    }
  });

  it("names each surface once", () => {
    expect(new Set(SURFACES.map((s) => s.tool)).size).toBe(SURFACES.length);
  });
});
