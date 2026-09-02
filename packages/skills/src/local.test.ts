import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverGlobalSkills,
  listGlobalSkillFiles,
  projectSkillRoots,
  resolveGlobalSkillFile,
  type GlobalSkillRoot,
} from "./local.js";

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): { directory: string; roots: GlobalSkillRoot[] } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-global-skills-"));
  temporary.push(directory);
  return {
    directory,
    roots: [{ id: "agents", label: "Agent Skills", directory }],
  };
}

describe("discoverGlobalSkills", () => {
  it("reads nested SKILL.md files and their frontmatter", () => {
    const { directory, roots } = fixture();
    const skillDirectory = path.join(directory, "vendor", "review");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      '---\nname: "Review changes"\ndescription: Check a patch carefully.\n---\n\n# Workflow\n',
    );

    expect(discoverGlobalSkills(roots)).toMatchObject([
      {
        id: "global:agents:vendor:review",
        name: "Review changes",
        description: "Check a patch carefully.",
        source: "Agent Skills",
        status: "installed",
        managedExternally: true,
      },
    ]);
  });

  it("deduplicates the same install exposed through a symlinked root", () => {
    const { directory } = fixture();
    const skillDirectory = path.join(directory, "shared");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(path.join(skillDirectory, "SKILL.md"), "# Shared\n");
    const linkRoot = `${directory}-link`;
    fs.symlinkSync(directory, linkRoot);
    temporary.push(linkRoot);

    const skills = discoverGlobalSkills([
      { id: "agents", label: "Agent Skills", directory },
      { id: "codex", label: "Codex", directory: linkRoot },
    ]);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("shared");
  });

  it("lists a complete skill folder and resolves files within it", () => {
    const { directory } = fixture();
    const skillDirectory = path.join(directory, "review");
    fs.mkdirSync(path.join(skillDirectory, "references"), { recursive: true });
    const location = path.join(skillDirectory, "SKILL.md");
    fs.writeFileSync(location, "# Review\n");
    fs.writeFileSync(path.join(skillDirectory, "references", "checklist.md"), "# Checklist\n");

    expect(listGlobalSkillFiles(location)).toEqual([
      { name: "references", path: "references", type: "directory" },
      { name: "SKILL.md", path: "SKILL.md", type: "file" },
    ]);
    expect(listGlobalSkillFiles(location, "references")).toEqual([
      { name: "checklist.md", path: "references/checklist.md", type: "file" },
    ]);
    expect(resolveGlobalSkillFile(location, "references/checklist.md")).toBe(
      fs.realpathSync(path.join(skillDirectory, "references", "checklist.md")),
    );
  });

  it("refuses traversal and omits symlinks that leave the skill folder", () => {
    const { directory } = fixture();
    const skillDirectory = path.join(directory, "review");
    const outside = path.join(directory, "outside.txt");
    fs.mkdirSync(skillDirectory, { recursive: true });
    const location = path.join(skillDirectory, "SKILL.md");
    fs.writeFileSync(location, "# Review\n");
    fs.writeFileSync(outside, "private\n");
    fs.symlinkSync(outside, path.join(skillDirectory, "outside-link.txt"));

    expect(() => resolveGlobalSkillFile(location, "../outside.txt")).toThrow(
      "outside the skill folder",
    );
    expect(listGlobalSkillFiles(location).map((entry) => entry.name)).toEqual(["SKILL.md"]);
  });
});

describe("skills a project carries", () => {
  it("finds a skill checked into the repository", () => {
    const repository = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-project-skill-"));
    const skillDirectory = path.join(repository, ".claude", "skills", "release");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      "---\nname: Release\ndescription: Cut a release\n---\n\nSteps…\n",
    );

    const found = discoverGlobalSkills(projectSkillRoots(repository));
    expect(found.map((skill) => skill.name)).toEqual(["Release"]);
    expect(found[0]?.source).toBe("This project");
  });

  it("has nothing to find without a folder", () => {
    expect(projectSkillRoots(undefined)).toEqual([]);
  });
});

describe("skills the agent keeps to itself", () => {
  function withFrontmatter(line: string): number {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-invocable-"));
    const skillDirectory = path.join(root, "skills", "internal");
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(skillDirectory, "SKILL.md"),
      `---\nname: Internal\n${line}\n---\n\nBody\n`,
    );
    return discoverGlobalSkills([
      { id: "test", label: "Test", directory: path.join(root, "skills") },
    ]).length;
  }

  it("leaves out one marked not user-invocable", () => {
    expect(withFrontmatter("user-invocable: false")).toBe(0);
    // YAML 1.1 spellings, which is what these files are written in.
    expect(withFrontmatter("user-invocable: no")).toBe(0);
    expect(withFrontmatter("user-invocable: off")).toBe(0);
    expect(withFrontmatter("user-invocable: 0")).toBe(0);
  });

  it("keeps everything else", () => {
    expect(withFrontmatter("user-invocable: true")).toBe(1);
    expect(withFrontmatter("user-invocable: yes")).toBe(1);
    expect(withFrontmatter("description: Plain")).toBe(1);
  });
});
