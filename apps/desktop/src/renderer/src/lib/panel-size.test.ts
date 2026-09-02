import { describe, expect, it } from "vitest";

import { clampPanelWidth, fitPanelWidth } from "./panel-size";

const base = { current: 520, available: 1280, min: 340, max: 1080, minContent: 480 };

describe("clampPanelWidth", () => {
  it("stops a drag before the conversation is crushed", () => {
    // 1280 wide with 480 reserved for the conversation leaves 800.
    expect(clampPanelWidth({ ...base, requested: 1080 })).toBe(800);
  });

  it("allows a drag that leaves room", () => {
    expect(clampPanelWidth({ ...base, requested: 700 })).toBe(700);
  });

  it("always lets the panel shrink, even past what the room allows", () => {
    // A window that is already too narrow must not trap the panel at its
    // current width.
    expect(clampPanelWidth({ ...base, current: 900, available: 900, requested: 400 })).toBe(400);
  });

  it("respects its own bounds", () => {
    expect(clampPanelWidth({ ...base, requested: 10 })).toBe(340);
    expect(clampPanelWidth({ ...base, available: 4000, requested: 3000 })).toBe(1080);
  });
});

describe("fitPanelWidth", () => {
  it("gives the conversation its minimum back when the window shrinks", () => {
    expect(fitPanelWidth({ current: 800, available: 1000, min: 340, minContent: 480 })).toBe(520);
  });

  it("leaves a panel that already fits alone", () => {
    expect(fitPanelWidth({ current: 520, available: 1280, min: 340, minContent: 480 })).toBe(520);
  });

  it("never shrinks below the panel's own minimum", () => {
    expect(fitPanelWidth({ current: 520, available: 600, min: 340, minContent: 480 })).toBe(340);
  });
});
