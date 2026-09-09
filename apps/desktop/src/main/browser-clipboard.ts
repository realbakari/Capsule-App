import type { NativeImage, WebContents } from "electron";
import { boundedBrowserOperation, readNavigableUrl } from "./browser-tools";

/** Keep pixels in main; the renderer must never substitute data-URL text. */
export async function copyBrowserScreenshot(contents: WebContents, writeImage: (image: NativeImage) => void): Promise<void> {
  if (contents.isDestroyed() || !readNavigableUrl(contents.getURL()).url) throw new Error("Open a web page before capturing a screenshot.");
  const image = await boundedBrowserOperation(contents.capturePage());
  if (contents.isDestroyed()) throw new Error("The browser page closed before its screenshot was ready.");
  if (image.isEmpty()) throw new Error("The browser has not painted an image yet. Wait for the page and retry.");
  writeImage(image);
}
