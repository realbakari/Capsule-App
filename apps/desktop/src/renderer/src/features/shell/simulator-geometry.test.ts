import { describe, expect, it } from "vitest";
import type { SimulatorFrame } from "@capsule/shared";
import { deviceGeometry, devicePoints, pointOnScreen, rotateClockwise, stepZoom } from "./simulator-geometry";

const frame = (extra: Partial<SimulatorFrame> = {}): SimulatorFrame => ({
  udid: "u", dataUrl: "data:,", pixelWidth: 1320, pixelHeight: 2868, capturedAt: "now", ...extra,
});

describe("simulator geometry", () => {
  it("draws the screen at the device's own shape, so it never letterboxes", () => {
    const points = devicePoints(frame({ pointWidth: 440, pointHeight: 956 }), "iPhone");
    // A narrow, tall pane: the width is the limit.
    const fit = deviceGeometry(points, "iPhone", { width: 300, height: 1200 }, "fit");
    expect(fit.frame.width).toBeCloseTo(300, 5);
    expect(fit.screen.width / fit.screen.height).toBeCloseTo(440 / 956, 6);
    // A wide, short pane: the height is the limit.
    const short = deviceGeometry(points, "iPhone", { width: 1200, height: 500 }, "fit");
    expect(short.frame.height).toBeCloseTo(500, 5);
  });

  it("shows one device point per CSS pixel at actual size", () => {
    const actual = deviceGeometry({ width: 440, height: 956 }, "iPhone", { width: 100, height: 100 }, 1);
    expect(actual.screen).toEqual({ width: 440, height: 956 });
  });

  it("estimates points from the frame until the touch bridge reports them", () => {
    expect(devicePoints(frame(), "iPhone")).toEqual({ width: 440, height: 956 });
    expect(devicePoints(undefined, "iPad")).toEqual({ width: 834, height: 1210 });
  });

  it("steps zoom from wherever fit left it, and stops at the ends", () => {
    expect(stepZoom(0.62, "in")).toBe(0.75);
    expect(stepZoom(0.62, "out")).toBe(0.5);
    expect(stepZoom(2, "in")).toBe(2);
    expect(stepZoom(0.5, "out")).toBe(0.5);
  });

  it("turns a quarter clockwise and comes back round", () => {
    let orientation = rotateClockwise(undefined);
    expect(orientation).toBe("landscapeRight");
    orientation = rotateClockwise(rotateClockwise(rotateClockwise(orientation)));
    expect(orientation).toBe("portrait");
  });

  it("maps a pointer on the drawn screen back to device points", () => {
    const rect = { left: 100, top: 50, width: 220, height: 478 };
    expect(pointOnScreen(210, 289, rect, { width: 440, height: 956 })).toEqual({ x: 220, y: 478 });
    expect(pointOnScreen(90, 289, rect, { width: 440, height: 956 })).toBeUndefined();
  });
});
