import { describe, expect, it } from "vitest";
import { SURFACES, applies, looksLikeMobileApp, onBar, type SurfaceState } from "./surfaces.js";

const reasons = (state: { projectId?: string; git?: { isRepo?: boolean }; groupId?: string }) =>
  Object.fromEntries(SURFACES.map((s) => [s.tool, s.blockedBy(state)]));

describe("inspector surfaces", () => {
  it("blocks what needs a project, naming why", () => {
    const blocked = reasons({});
    expect(blocked.files).toBe("Open a project first.");
  });

  const bar = (state: SurfaceState, active?: Parameters<typeof onBar>[2]) =>
    SURFACES.filter((s) => onBar(s, state, active)).map((s) => s.tool);

  it("puts the panel surfaces on the bar in order, with the rest under More", () => {
    expect(bar({ folderNames: ["App.xcodeproj"] })).toEqual(["review", "browser", "simulator", "files"]);
    expect(SURFACES.filter((s) => !onBar(s, { folderNames: ["App.xcodeproj"] })).map((s) => s.tool)).toEqual(["agents", "compare"]);
    // The terminal is the real dock, toggled from the bar, not a panel surface.
    expect(SURFACES.some((s) => (s.tool as string) === "terminal")).toBe(false);
  });

  it("blocks review outside a Git repository", () => {
    expect(reasons({ projectId: "p1", git: { isRepo: false } }).review).toBe(
      "Available for Git repositories.",
    );
  });

  it("does not block review while the repository status is still loading", () => {
    expect(reasons({ projectId: "p1" }).review).toBeUndefined();
  });

  it("opens everything once there is a project, a repository and a comparison", () => {
    const blocked = reasons({ projectId: "p1", git: { isRepo: true }, groupId: "g1" });
    expect(Object.values(blocked).every((reason) => reason === undefined)).toBe(true);
  });

  it("keeps the surfaces that need neither always available", () => {
    const blocked = reasons({});
    // A browser does not depend on a folder being open.
    expect(blocked.browser).toBeUndefined();
  });

  it("keeps the simulator on the desktop, on a Mac", () => {
    const state = { projectId: "p1", git: { isRepo: true } };
    const simulator = SURFACES.find((s) => s.tool === "simulator")!;
    expect(simulator.blockedBy({ ...state, desktop: false })).toBe("Available in the desktop app.");
    expect(simulator.blockedBy({ ...state, desktop: true, platform: "win32" })).toBe("Available on macOS with Xcode.");
    expect(simulator.blockedBy({ ...state, desktop: true, platform: "darwin" })).toBeUndefined();
    // No project is needed: the simulator belongs to the Mac, not a folder.
    expect(simulator.blockedBy({ desktop: true, platform: "darwin" })).toBeUndefined();
  });

  it("shows the simulator only for a project it can run, an attached simulator, or while it is open", () => {
    const web = { git: { isRepo: true }, folderNames: ["package.json", "src", "README.md"] };
    expect(bar(web)).toEqual(["review", "browser", "files"]);
    expect(bar({ ...web, simulatorAttached: true })).toContain("simulator");
    expect(bar(web, "simulator")).toContain("simulator");
    for (const marker of ["Weather.xcodeproj", "Weather.xcworkspace", "Package.swift", "ios", "eas.json", "Podfile", "project.yml"]) {
      expect(looksLikeMobileApp([...web.folderNames, marker]), marker).toBe(true);
    }
    expect(looksLikeMobileApp(["iosevka.css", "app.config.ts", "Package.swift.bak"])).toBe(false);
  });

  it("moves Review to More in a folder known not to be a repository, unless it is open", () => {
    expect(bar({ git: { isRepo: false } })).not.toContain("review");
    expect(bar({ git: { isRepo: false } }, "review")).toContain("review");
    // Still loading: Review stays where it will be.
    expect(bar({})).toContain("review");
  });

  it("offers in the launcher only the surfaces that apply to this folder and thread", () => {
    const launcher = (state: SurfaceState) => SURFACES.filter((s) => applies(s, state)).map((s) => s.tool);
    const mac = { desktop: true, platform: "darwin" };
    expect(launcher({ ...mac, git: { isRepo: true }, folderNames: ["package.json"] })).toEqual(["review", "browser", "files", "agents"]);
    expect(launcher({ ...mac, git: { isRepo: false }, folderNames: ["App.xcodeproj"], groupId: "g1" })).toEqual(["browser", "simulator", "files", "agents", "compare"]);
    expect(launcher({ desktop: false, folderNames: ["App.xcodeproj"] })).not.toContain("simulator");
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
