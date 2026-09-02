/**
 * Where the window was last time.
 *
 * Capsule opened a fresh 1280x820 window on every launch, so anyone who works
 * in a bigger window watched the app open small and then resized it — or
 * watched macOS resize it for them, which reads as the app opening twice.
 */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends WindowBounds {
  maximized: boolean;
}

export interface DisplayArea {
  /** The work area, so a restored window clears the menu bar and the Dock. */
  workArea: WindowBounds;
}

export const DEFAULT_WINDOW_SIZE = { width: 1280, height: 820 };
const MIN_WIDTH = 960;
const MIN_HEIGHT = 640;
/** How much of the window has to land on a display for it to be reachable. */
const MIN_VISIBLE = 80;

function overlap(a: WindowBounds, b: WindowBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

/** Reads a saved state, rejecting anything that is not a usable rectangle. */
export function parseWindowState(raw: unknown): WindowState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<WindowState>;
  const numbers = [value.x, value.y, value.width, value.height];
  if (!numbers.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return undefined;
  }
  if ((value.width ?? 0) < MIN_WIDTH || (value.height ?? 0) < MIN_HEIGHT) return undefined;
  return {
    x: Math.round(value.x!),
    y: Math.round(value.y!),
    width: Math.round(value.width!),
    height: Math.round(value.height!),
    maximized: value.maximized === true,
  };
}

/**
 * The bounds to open with. A window saved on a monitor that is no longer
 * attached would otherwise open where nobody can see it, so it comes back to
 * the primary display at the size it had.
 */
export function restoreWindowBounds(
  state: WindowState | undefined,
  displays: readonly DisplayArea[],
): WindowBounds | undefined {
  if (!state || displays.length === 0) return undefined;
  const bounds: WindowBounds = {
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
  };
  const visible = displays.some((display) => overlap(bounds, display.workArea) >= MIN_VISIBLE * MIN_VISIBLE);
  if (visible) return bounds;

  const primary = displays[0]!.workArea;
  const width = Math.min(bounds.width, primary.width);
  const height = Math.min(bounds.height, primary.height);
  return {
    width,
    height,
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
  };
}
