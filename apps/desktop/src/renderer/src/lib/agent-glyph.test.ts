import { describe, expect, it } from "vitest";

import { agentAccent, agentInitials, providerMark, relativeLuminance } from "./agent-glyph";

describe("agentInitials", () => {
  it("takes one letter from each of the first two words", () => {
    expect(agentInitials("OpenClaw ACP")).toBe("OA");
    expect(agentInitials("New Thread")).toBe("NT");
  });

  it("takes two letters from a single word", () => {
    expect(agentInitials("Codex")).toBe("CO");
  });

  it("treats separators as word breaks", () => {
    expect(agentInitials("fast-agent")).toBe("FA");
    expect(agentInitials("kilo_code")).toBe("KC");
  });

  it("does not return an empty tile for an empty name", () => {
    expect(agentInitials("   ")).toBe("?");
  });
});

describe("providerMark", () => {
  it("draws a mark for the providers that have one", () => {
    expect(providerMark("claude")?.paths.length).toBeGreaterThan(0);
    expect(providerMark("Codex")?.paths.length).toBeGreaterThan(0);
  });

  it("leaves the rest on the monogram tile", () => {
    // The set has no mark for these, and inventing one would name the wrong
    // product.
    expect(providerMark("openclaw")).toBeUndefined();
    expect(providerMark(undefined)).toBeUndefined();
  });
});

describe("agentAccent", () => {
  it("keeps a brand colour that reads on a dark surface", () => {
    expect(agentAccent("claude")).toBe("#d97757");
  });

  it("leaves a mark with no brand colour on the row's own colour", () => {
    expect(providerMark("cursor")?.hex).toBeUndefined();
    expect(agentAccent("cursor")).toBeUndefined();
  });

  it("measures lightness rather than guessing", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
    expect(relativeLuminance("#d97757")).toBeGreaterThan(relativeLuminance("#6950ef"));
  });
});
