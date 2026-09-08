import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { prepareDirectPrompt } from "./direct-prompt.js";

it("sends bounded image, PDF and text bytes instead of claiming paths are attachments", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "capsule-rich-prompt-"));
  try {
    const attachments = [
      { name: "image.png", mimeType: "image/png", content: Buffer.from([137, 80, 78, 71]) },
      { name: "document.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF-1.7") },
      { name: "source.ts", mimeType: "text/plain", content: Buffer.from("const café = 1;\n") },
    ];
    const inputs = [];
    for (const item of attachments) {
      const file = path.join(directory, item.name); await writeFile(file, item.content);
      inputs.push({ name: item.name, path: file, mimeType: item.mimeType, size: item.content.length });
    }
    const report = { images: true, embeddedContext: true, configOptions: [] };
    expect(await prepareDirectPrompt("Inspect", inputs, report)).toMatchObject([
      { type: "text", text: "Inspect" }, { type: "image", data: attachments[0]!.content.toString("base64") },
      { type: "resource", resource: { blob: attachments[1]!.content.toString("base64") } },
      { type: "resource", resource: { text: "const café = 1;\n" } },
    ]);
    await expect(prepareDirectPrompt("Inspect", inputs, { configOptions: [] })).rejects.toThrow("native image");
    await writeFile(inputs[0]!.path, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(prepareDirectPrompt("Inspect", inputs, report)).rejects.toThrow("too large");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
