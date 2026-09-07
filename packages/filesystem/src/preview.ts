import { readBoundedFile, FileTooLargeError } from "./bounded-read.js";
import type { FilePreview } from "@capsule/shared";
import {
  localTimings,
  fileContentRevision,
  imageMimeFromFilename,
  languageFromFilename,
  previewKindFromFilename,
} from "@capsule/shared";

const TEXT_LIMIT = 120_000;
const IMAGE_LIMIT = 6_000_000;

function looksLikeText(bytes: Buffer): boolean {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_192));
  if (sample.includes(0)) return false;
  let odd = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 13 && byte < 32)) odd += 1;
  }
  return odd / Math.max(sample.length, 1) < 0.08;
}

function looksLikeSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf8").trimStart();
  return head.startsWith("<svg") || head.startsWith("<?xml");
}

export function previewFromBytes(path: string, bytes: Buffer): FilePreview {
  const named = previewKindFromFilename(path);
  const imageMime = imageMimeFromFilename(path);
  const language = languageFromFilename(path);
  const size = bytes.length;

  if (named === "image" || (imageMime && looksLikeSvg(bytes))) {
    if (size > IMAGE_LIMIT) {
      return {
        path,
        kind: "binary",
        mime: imageMime,
        truncated: true,
        size,
        detail: "Image is too large to preview in Capsule.",
      };
    }
    const mime = imageMime ?? "application/octet-stream";
    return {
      path,
      kind: "image",
      mime,
      dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      truncated: false,
      size,
    };
  }

  if (named === "binary" || !looksLikeText(bytes)) {
    return {
      path,
      kind: "binary",
      language,
      truncated: false,
      size,
      detail: "This file isn’t text or an image Capsule can show.",
    };
  }

  const contents = bytes.toString("utf8");
  const truncated = contents.length > TEXT_LIMIT;
  const shown = truncated ? contents.slice(0, TEXT_LIMIT) : contents;
  return {
    path,
    kind: "text",
    language,
    contents: shown,
    truncated,
    revision: fileContentRevision(contents),
    size,
  };
}

export async function readPreviewFile(absolutePath: string, relative: string, projectRoot?: string): Promise<FilePreview> {
  const end = localTimings.start("preview.read");
  try { const result = await readPreview(absolutePath, relative, projectRoot); end(); return result; }
  catch (error) { end(true); throw error; }
}

async function readPreview(absolutePath: string, relative: string, projectRoot?: string): Promise<FilePreview> {
  const limit = previewKindFromFilename(relative) === "image" ? IMAGE_LIMIT : 1_000_000;
  try {
    return previewFromBytes(relative, await readBoundedFile(absolutePath, limit, projectRoot));
  } catch (error) {
    if (error instanceof FileTooLargeError) {
      return { path: relative, kind: "binary", truncated: true, size: error.size, detail: "File is too large to preview." };
    }
    throw error;
  }
}
