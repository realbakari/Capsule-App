import fs from "node:fs";
import path from "node:path";
import type { MessageAttachment } from "@capsule/shared";

export const MAX_MESSAGE_ATTACHMENTS = 8;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".zip": "application/zip",
};

export function validateMessageAttachments(
  input: ReadonlyArray<Pick<MessageAttachment, "name" | "path">>,
): MessageAttachment[] {
  if (input.length > MAX_MESSAGE_ATTACHMENTS) {
    throw new Error(`Attach at most ${MAX_MESSAGE_ATTACHMENTS} files to one message.`);
  }
  return input.map((attachment) => {
    const filePath = path.resolve(attachment.path);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new Error(`Attachment not found: ${attachment.name || path.basename(filePath)}`);
    }
    if (!stat.isFile()) throw new Error(`Attachment is not a file: ${attachment.name || filePath}`);
    if (stat.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
      throw new Error(`Attachment is larger than 50 MB: ${attachment.name || path.basename(filePath)}`);
    }
    const name = path.basename(attachment.name || filePath).slice(0, 240);
    const mimeType = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    return { name, path: filePath, size: stat.size, ...(mimeType ? { mimeType } : {}) };
  });
}

export function attachmentPromptBlock(attachments: readonly MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const rows = attachments.map((attachment) => `- ${attachment.name}: ${attachment.path}`);
  return `\n\n[Attached files]\n${rows.join("\n")}\nUse these exact local paths when reading the attachments.`;
}

