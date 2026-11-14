import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { protocol } from "electron";
import { BACKDROP_IMAGE_EXTENSIONS, BACKDROP_SCHEME, MAX_BACKDROP_IMAGE_BYTES } from "@capsule/shared";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/** Before the app is ready. CORS lets the renderer sample the image's colours for the readability veil. */
export function registerBackdropScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: BACKDROP_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true, supportFetchAPI: true } }]);
}

/**
 * Serves only files the config service checked and handed out a token for.
 * The file is checked again here, since it may have changed since.
 */
export function serveBackdropImages(fileFor: (token: string) => string | undefined): void {
  protocol.handle(BACKDROP_SCHEME, (request) => {
    const url = new URL(request.url);
    const file = url.host === "image" ? fileFor(decodeURIComponent(url.pathname.slice(1))) : undefined;
    const extension = file ? path.extname(file).toLowerCase() : "";
    try {
      if (!file || !(BACKDROP_IMAGE_EXTENSIONS as readonly string[]).includes(extension)) return new Response(null, { status: 404 });
      if (statSync(file).size > MAX_BACKDROP_IMAGE_BYTES) return new Response(null, { status: 413 });
      return new Response(readFileSync(file), {
        headers: { "content-type": TYPES[extension]!, "access-control-allow-origin": "*", "cache-control": "private, max-age=31536000, immutable" },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}
