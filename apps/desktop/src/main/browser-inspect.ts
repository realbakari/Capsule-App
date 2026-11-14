import type { WebContents } from "electron";
import { browserDevice } from "@capsule/shared";
import { boundedBrowserOperation } from "./browser-tools";

export interface ElementRect { x: number; y: number; width: number; height: number }

/** A rect in CSS pixels from the page, checked and clipped to the visible page in DIPs. */
export function captureRect(value: unknown, zoom: number, view: { width: number; height: number }): ElementRect | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<ElementRect>;
  if (![raw.x, raw.y, raw.width, raw.height].every((n) => typeof n === "number" && Number.isFinite(n))) return undefined;
  const left = Math.max(0, Math.floor(raw.x! * zoom));
  const top = Math.max(0, Math.floor(raw.y! * zoom));
  const right = Math.min(view.width, Math.ceil((raw.x! + raw.width!) * zoom));
  const bottom = Math.min(view.height, Math.ceil((raw.y! + raw.height!) * zoom));
  if (right - left < 1 || bottom - top < 1) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** PNG bytes of the part of the page an inspected element covers, or undefined when it is off screen. */
export async function captureElement(contents: WebContents, rect: unknown): Promise<Uint8Array | undefined> {
  const view = await boundedBrowserOperation(contents.executeJavaScript("({ width: innerWidth, height: innerHeight })") as Promise<{ width: number; height: number }>);
  const clip = captureRect(rect, contents.getZoomFactor(), { width: view.width * contents.getZoomFactor(), height: view.height * contents.getZoomFactor() });
  if (!clip) return undefined;
  const image = await boundedBrowserOperation(contents.capturePage(clip));
  return image.isEmpty() ? undefined : image.toPNG();
}

/** Responsive turns emulation off; every other device fixes the page size, pixel ratio and screen mode. */
export function emulateDevice(contents: WebContents, id: unknown): void {
  const device = browserDevice(id);
  if (!device) throw new Error("Choose Responsive, iPhone, iPad or Desktop.");
  if (!device.width || !device.height) {
    contents.disableDeviceEmulation();
    return;
  }
  contents.enableDeviceEmulation({
    screenPosition: device.mobile ? "mobile" : "desktop",
    screenSize: { width: device.width, height: device.height },
    viewPosition: { x: 0, y: 0 },
    viewSize: { width: device.width, height: device.height },
    deviceScaleFactor: device.scale ?? 0,
    scale: 1,
  });
}
