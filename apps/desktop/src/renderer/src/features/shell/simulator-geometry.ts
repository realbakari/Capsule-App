import type { SimulatorFrame, SimulatorOrientation } from "@capsule/shared";

/**
 * How big the device draws. "fit" fills the stage; a number is a scale where
 * 1 is actual size, one device point to one CSS pixel. The frame is always
 * sized from the device's own shape, so the screen image fills it exactly and
 * a pointer position maps straight back to device points.
 */
export type SimulatorZoom = "fit" | number;

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export interface Size { width: number; height: number }

export interface DeviceGeometry {
  scale: number;
  screen: Size;
  /** Bezel thickness around the screen, in CSS pixels. */
  border: number;
  screenRadius: number;
  frame: Size;
}

/* Shapes used before the first frame names the real one: an iPhone Pro Max and an 11-inch iPad, in points. */
const FALLBACK_POINTS: Record<string, Size> = {
  iPhone: { width: 440, height: 956 },
  iPad: { width: 834, height: 1210 },
};

/** The screen in device points: what the touch bridge reported, else the frame scaled by a typical density. */
export function devicePoints(frame: SimulatorFrame | undefined, family: string): Size {
  if (frame?.pointWidth && frame.pointHeight) return { width: frame.pointWidth, height: frame.pointHeight };
  const density = family === "iPad" ? 2 : 3;
  if (frame) return { width: frame.pixelWidth / density, height: frame.pixelHeight / density };
  return FALLBACK_POINTS[family] ?? FALLBACK_POINTS.iPhone!;
}

/** Frame proportions per family, as fractions of the screen's shorter side. */
function bezelFor(family: string): { border: number; radius: number } {
  if (family === "iPad") return { border: 0.03, radius: 0.025 };
  return { border: 0.035, radius: 0.13 };
}

export function fitScale(points: Size, family: string, stage: Size): number {
  const { border } = bezelFor(family);
  const short = Math.min(points.width, points.height);
  const width = points.width + 2 * border * short;
  const height = points.height + 2 * border * short;
  if (stage.width <= 0 || stage.height <= 0) return 0;
  return Math.min(stage.width / width, stage.height / height);
}

export function deviceGeometry(points: Size, family: string, stage: Size, zoom: SimulatorZoom): DeviceGeometry {
  const scale = zoom === "fit" ? fitScale(points, family, stage) : zoom;
  const { border, radius } = bezelFor(family);
  const short = Math.min(points.width, points.height) * scale;
  const screen = { width: points.width * scale, height: points.height * scale };
  const thickness = border * short;
  return {
    scale,
    screen,
    border: thickness,
    screenRadius: radius * short,
    frame: { width: screen.width + 2 * thickness, height: screen.height + 2 * thickness },
  };
}

/** The next zoom step in a direction, starting from whatever scale is showing now. */
export function stepZoom(scale: number, direction: "in" | "out"): number {
  if (direction === "in") return ZOOM_STEPS.find((step) => step > scale + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((step) => step < scale - 0.001) ?? ZOOM_STEPS[0]!;
}

const CLOCKWISE: SimulatorOrientation[] = ["portrait", "landscapeRight", "portraitUpsideDown", "landscapeLeft"];

/** A quarter turn clockwise, the way the device rotates when turned to the right. */
export function rotateClockwise(orientation: SimulatorOrientation | undefined): SimulatorOrientation {
  const index = CLOCKWISE.indexOf(orientation ?? "portrait");
  return CLOCKWISE[(index + 1) % CLOCKWISE.length]!;
}

/** A pointer position over the drawn screen, in device points; undefined outside it. */
export function pointOnScreen(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, points: Size): { x: number; y: number } | undefined {
  if (!rect.width || !rect.height) return undefined;
  const x = ((clientX - rect.left) / rect.width) * points.width;
  const y = ((clientY - rect.top) / rect.height) * points.height;
  if (x < 0 || y < 0 || x > points.width || y > points.height) return undefined;
  return { x, y };
}
