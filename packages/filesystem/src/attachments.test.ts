import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { attachmentPromptBlock, validateMessageAttachments } from "./attachments.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("message attachments", () => {
  it("normalizes existing files and builds an explicit agent prompt block", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-attachment-"));
    roots.push(root);
    const file = path.join(root, "notes.md");
    fs.writeFileSync(file, "hello");
    const attachments = validateMessageAttachments([{ name: "notes.md", path: file }]);
    expect(attachments[0]).toMatchObject({ name: "notes.md", path: file, size: 5, mimeType: "text/markdown" });
    expect(attachmentPromptBlock(attachments)).toContain(file);
  });

  it("rejects missing files", () => {
    expect(() => validateMessageAttachments([{ name: "missing.txt", path: "/missing/file" }])).toThrow(
      "Attachment not found",
    );
  });
});

