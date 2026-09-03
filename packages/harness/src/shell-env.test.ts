import { describe, expect, it } from "vitest";

import { mergePath, parseShellEnvironment, readLoginShellEnvironment } from "./shell-env.js";

describe("parseShellEnvironment", () => {
  it("takes the variables it asked for", () => {
    expect(parseShellEnvironment("PATH=/a:/b\nHOME=/nope\nBUN_INSTALL=/c\n")).toEqual({
      PATH: "/a:/b",
      BUN_INSTALL: "/c",
    });
  });

  it("ignores what an rc file prints on the way past", () => {
    // A login shell runs the user's dotfiles, and those greet, warn and
    // announce version managers. None of that is an assignment.
    const noisy = "Welcome back!\nnvm: using v22\nPATH=/a\n=broken\nnot a line";
    expect(parseShellEnvironment(noisy)).toEqual({ PATH: "/a" });
  });

  it("drops an empty value rather than blanking the real one", () => {
    expect(parseShellEnvironment("PATH=\n")).toEqual({});
  });
});

describe("mergePath", () => {
  it("keeps the first occurrence of each entry, in order", () => {
    expect(mergePath("/a:/b", "/b:/c", "/a:/d")).toBe("/a:/b:/c:/d");
  });

  it("survives the pieces it is missing", () => {
    expect(mergePath(undefined, "/a", "")).toBe("/a");
    expect(mergePath()).toBe("");
  });

  it("ignores stray separators", () => {
    expect(mergePath("/a::/b:")).toBe("/a:/b");
  });
});

describe("readLoginShellEnvironment", () => {
  it("says nothing on Windows rather than running a POSIX shell", () => {
    expect(readLoginShellEnvironment({ platform: "win32" })).toEqual({});
  });

  it("finds the PATH this machine's shell actually has", () => {
    // The point of the whole module: an app launched from the Dock gets a
    // minimal PATH, and the entries a harness lives in are in the shell's.
    const env = readLoginShellEnvironment();
    expect(env.PATH ?? "").toContain("/bin");
  });
});

describe("the PATH a Dock-launched app would end up with", () => {
  it("gains the directories a harness actually lives in", () => {
    /*
     * The real failure this module exists for. macOS hands a GUI app roughly
     * this PATH, and the hardcoded list Capsule used to add to it did not
     * mention ~/.grok/bin or ~/.kimi-code/bin — so Grok Build and Kimi were
     * invisible unless the app was started from a terminal, and any process
     * Capsule spawned inherited the same gap.
     */
    const dockPath = "/usr/bin:/bin:/usr/sbin:/sbin";
    const merged = mergePath(readLoginShellEnvironment().PATH, dockPath);
    expect(merged.split(":").length).toBeGreaterThan(4);
    // Whatever this machine has, the shell's entries are now in front of the
    // minimal ones rather than missing.
    expect(merged.startsWith("/usr/bin:")).toBe(false);
    expect(merged).toContain("/usr/bin");
  });
});
