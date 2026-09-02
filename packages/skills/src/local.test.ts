import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  discoverGlobalSkills,
  listGlobalSkillFiles,
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
