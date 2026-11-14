import { describe, expect, it } from "vitest";
import { regionOf } from "./regions";

describe("region cycling", () => {
  it("finds which region holds focus", () => {
    const inside = { id: "x" } as unknown as Element;
    const root = { contains: (node: unknown) => node === inside } as unknown as HTMLElement;
    expect(regionOf(inside, [null, root])).toBe(1);
    expect(regionOf(null, [root])).toBe(-1);
  });
});
