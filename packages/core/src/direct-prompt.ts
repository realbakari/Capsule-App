import { pathToFileURL } from "node:url";
import { readBoundedFile } from "@capsule/filesystem";
import type { AgentCapabilityReport, AgentPromptBlock, MessageAttachment } from "@capsule/shared";

const FILE_BYTES = 2 * 1024 * 1024;
const TOTAL_BYTES = 3 * 1024 * 1024 - 16384;

/** Materialize only explicitly attached files, without persisting binary prompt data. */
export async function prepareDirectPrompt(text: string, attachments: readonly MessageAttachment[], capabilities?: AgentCapabilityReport): Promise<AgentPromptBlock[]> {
  const blocks: AgentPromptBlock[] = [{ type: "text", text }];
  if (attachments.length > 8) throw new Error("Attach at most 8 files.");
  let retained = Buffer.byteLength(text);
  for (const attachment of attachments) {
    const mimeType = attachment.mimeType ?? "application/octet-stream";
    const image = /^image\/(png|jpeg|gif|webp|avif)$/.test(mimeType);
    if (image && capabilities?.images !== true) throw new Error(`This agent does not accept native image prompts (${attachment.name}). Remove it or select an image-capable agent.`);
    if (!image && capabilities?.embeddedContext !== true) throw new Error(`This agent does not accept embedded resources (${attachment.name}). Remove it or select a compatible agent.`);
    const bytes = await readBoundedFile(attachment.path, Math.min(FILE_BYTES, Math.max(0, TOTAL_BYTES - retained)));
    retained += bytes.length;
    if (retained > TOTAL_BYTES) throw new Error("Direct attachments exceed the 3 MB total budget. Attach smaller files.");
    if (image) blocks.push({ type: "image", mimeType, data: bytes.toString("base64") });
    else {
      const uri = pathToFileURL(attachment.path).href;
      // Decode only valid UTF-8 without NULs. PDFs and unknown binary files
      // retain their exact bytes instead of silently becoming broken text.
      let content: string | undefined;
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!bytes.includes(0) && mimeType !== "application/pdf" && mimeType !== "application/zip") content = decoded;
      } catch { /* Binary resource. */ }
      blocks.push({ type: "resource", resource: content === undefined
        ? { uri, mimeType, blob: bytes.toString("base64") }
        : { uri, mimeType: mimeType === "application/octet-stream" ? "text/plain" : mimeType, text: content } });
    }
  }
  return blocks;
}
