import { describe, expect, it } from "vitest";

import { parseWindowState, restoreWindowBounds } from "./window-state.js";

const laptop = { workArea: { x: 0, y: 25, width: 1512, height: 945 } };
const external = { workArea: { x: 1512, y: 0, width: 2560, height: 1415 } };

describe("parseWindowState", () => {
  it("reads a saved window", () => {
    expect(parseWindowState({ x: 10, y: 20, width: 1400, height: 900, maximized: true })).toEqual({
      x: 10,
      y: 20,
      width: 1400,
      height: 900,
      maximized: true,
    });
  });

  it("refuses anything that is not a window", () => {
    expect(parseWindowState(undefined)).toBeUndefined();
    expect(parseWindowState({ x: 0, y: 0, width: "wide", height: 900 })).toBeUndefined();
    // Smaller than the window's own minimum: restoring it would fight the
    // constraint and land somewhere nobody chose.
    expect(parseWindowState({ x: 0, y: 0, width: 400, height: 300 })).toBeUndefined();
  });
});

describe("restoreWindowBounds", () => {
  it("gives back the saved frame when it still lands on a display", () => {
    const saved = parseWindowState({ x: 1600, y: 100, width: 1800, height: 1000 });
    expect(restoreWindowBounds(saved, [laptop, external])).toEqual({
      x: 1600,
      y: 100,
      width: 1800,
      height: 1000,
    });
  });

  it("brings a window back when its monitor is gone", () => {
    // Saved on the external display, opened with only the laptop attached.
    const saved = parseWindowState({ x: 2400, y: 300, width: 1800, height: 1000 });
    expect(restoreWindowBounds(saved, [laptop])).toEqual({
      x: 0,
      y: 25,
      width: 1512,
      height: 945,
    });
  });

  it("has nothing to say without a saved window", () => {
    expect(restoreWindowBounds(undefined, [laptop])).toBeUndefined();
  });
});
