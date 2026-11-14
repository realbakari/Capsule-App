import { afterEach, describe, expect, it } from "vitest";
import { clearTurnAnchors, recallTurnAnchor, rememberTurnAnchor } from "./turn-anchors";

afterEach(clearTurnAnchors);

describe("reading position per thread", () => {
  it("remembers, forgets on follow, and keeps only recent threads", () => {
    rememberTurnAnchor("a", { id: "t3", offset: 40 });
    expect(recallTurnAnchor("a")).toEqual({ id: "t3", offset: 40 });
    rememberTurnAnchor("a", undefined);
    expect(recallTurnAnchor("a")).toBeUndefined();
    for (let index = 0; index < 70; index++) rememberTurnAnchor(`s${index}`, { id: "t", offset: index });
    expect(recallTurnAnchor("s0")).toBeUndefined();
    expect(recallTurnAnchor("s69")).toEqual({ id: "t", offset: 69 });
  });
});
