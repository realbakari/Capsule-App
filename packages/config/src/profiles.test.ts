import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigService } from "./service.js";
import { createTrustStore } from "./trust.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-profiles-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const userDir = path.join(home, ".capsule");
  const project = path.join(home, "project");
  mkdirSync(project, { recursive: true });
  let trusted: string | undefined;
  const service = new ConfigService({ userDir, homeDir: home, lastGoodDir: path.join(home, "last-good"), watch: false,
    trust: createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } }) });
  service.load();
  cleanups.push(() => service.close());
  const write = (file: string, text: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
  return { home, userDir, project, service, write, userFile: path.join(userDir, "settings.json"), localFile: path.join(project, ".capsule", "settings.local.json") };
}

describe("profiles and styles", () => {
  it("lets a project's profile win over the user's of the same name, and says so", () => {
    const { service, write, userDir, project } = fixture();
    write(path.join(userDir, "profiles", "reviewer.md"), "---\nname: Mine\nharness: claude\n---\n");
    write(path.join(project, ".capsule", "profiles", "reviewer.md"), "---\nname: Team reviewer\nharness: codex\n---\nRisks first.");
    write(path.join(userDir, "profiles", "fast.md"), "---\nname: Fast\npermission: nope\n---\n");
    const { profiles, problems } = service.profiles(project);
    expect(profiles.map((entry) => [entry.profile.id, entry.profile.name, entry.scope])).toEqual([["fast", "Fast", "user"], ["reviewer", "Team reviewer", "project"]]);
    expect(problems.map((problem) => problem.message)).toEqual([
      expect.stringMatching(/permission must be one of/),
      expect.stringMatching(/defines the profile "reviewer" too and wins/),
    ]);
    expect(service.diagnostics(project).problems.some((problem) => /permission must be one of/.test(problem.message))).toBe(true);
  });

  it("offers the built-in styles, and a file named after one replaces it", () => {
    const { service, write, userDir } = fixture();
    write(path.join(userDir, "styles", "concise.md"), "---\nname: Terse\n---\nOne line.");
    const styles = service.styles().styles;
    expect(styles.map((entry) => [entry.style.id, entry.source])).toEqual([["concise", "user"], ["standard", "builtin"], ["explanatory", "builtin"]]);
  });

  it("reads personal instructions from ~ or the settings folder, and names a missing file", () => {
    const { service, write, userFile, home } = fixture();
    write(path.join(home, "notes", "me.md"), "I use pnpm.");
    write(userFile, JSON.stringify({ personalInstructions: "~/notes/me.md" }));
    service.reload();
    expect(service.personalInstructions()).toEqual({ path: path.join(home, "notes", "me.md"), text: "I use pnpm." });
    write(userFile, JSON.stringify({ personalInstructions: "missing.md" }));
    service.reload();
    expect(service.personalInstructions()?.problem).toMatch(/could not be read/);
    expect(service.diagnostics().problems.some((problem) => problem.key === "personalInstructions")).toBe(true);
  });

  it("creates a profile from the template, and duplicates one with a new name", () => {
    const { service, write, userDir } = fixture();
    const first = service.createProfile({ scope: "user" });
    expect(path.basename(first)).toBe("new-profile.md");
    expect(path.basename(service.createProfile({ scope: "user" }))).toBe("new-profile-2.md");
    write(path.join(userDir, "profiles", "reviewer.md"), "---\nname: Reviewer\nharness: codex\n---\nRisks first.");
    const copy = service.createProfile({ scope: "user", from: "reviewer" });
    expect(readFileSync(copy, "utf8")).toBe("---\nname: Reviewer copy\nharness: codex\n---\nRisks first.");
    expect(service.ensureFile({ kind: "resource", folder: "profiles", scope: "user", name: "reviewer-copy" })).toBe(copy);
    expect(() => service.ensureFile({ kind: "resource", folder: "profiles", scope: "user", name: "../../settings" })).toThrow(/no profile file/);
  });
});

