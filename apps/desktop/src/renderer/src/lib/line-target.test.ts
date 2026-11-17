import { describe, expect, it } from "vitest";
import { lineSpan } from "./line-target";

describe("lineSpan", () => {
  const text = "first\nsecond\n\nfourth";
  it("finds a line by its 1-based number", () => {
    expect(lineSpan(text, 1)).toEqual({ start: 0, end: 5 });
    expect(text.slice(lineSpan(text, 2)!.start, lineSpan(text, 2)!.end)).toBe("second");
    expect(text.slice(lineSpan(text, 4)!.start, lineSpan(text, 4)!.end)).toBe("fourth");
  });
  it("keeps an empty line addressable", () => {
    expect(lineSpan(text, 3)).toEqual({ start: 13, end: 13 });
  });
  it("finds nothing past the end or below line 1", () => {
    expect(lineSpan(text, 5)).toBeUndefined();
    expect(lineSpan(text, 0)).toBeUndefined();
    expect(lineSpan(text, 1.5)).toBeUndefined();
  });
});
