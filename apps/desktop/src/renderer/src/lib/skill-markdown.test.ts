import { describe, expect, it } from "vitest";

import { skillMarkdownBody } from "./skill-markdown.js";

describe("skillMarkdownBody", () => {
  it("removes YAML frontmatter before rendering the guide", () => {
    expect(
      skillMarkdownBody("---\nname: review\ndescription: Review code.\n---\n\n# Workflow\n\n- Check tests"),
    ).toBe("# Workflow\n\n- Check tests");
  });

  it("keeps a Markdown document that has no frontmatter", () => {
    expect(skillMarkdownBody("# Workflow\n\nUse `pnpm test`.\n")).toBe(
      "# Workflow\n\nUse `pnpm test`.",
    );
  });
});
