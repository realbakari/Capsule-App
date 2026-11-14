import { describe, expect, it } from "vitest";

import { contrastRatio, mixHex } from "./appearance.js";
import { backdropScrim, mergeBackdrop, parseBackdrop, sceneSample, BACKDROP_SCENES } from "./backdrop.js";

describe("parseBackdrop", () => {
  it("keeps the valid fields and names each wrong one", () => {
    const { backdrop, problems } = parseBackdrop({ scene: "grain", fit: "stretch", blur: 4, dark: { dim: 0.4, glow: 1 }, light: 3 });
    expect(backdrop).toEqual({ scene: "grain", blur: 4, dark: { dim: 0.4 } });
    expect(problems.map((p) => [p.severity, p.key])).toEqual([
      ["error", "backdrop.fit"],
      ["error", "backdrop.light"],
      ["warning", "backdrop.dark.glow"],
    ]);
  });

  it("refuses a URL but accepts a Windows path", () => {
    expect(parseBackdrop({ image: "file:///x.png" }).backdrop).toEqual({});
    expect(parseBackdrop({ image: "C:\\pics\\x.png" }).backdrop).toEqual({ image: "C:\\pics\\x.png" });
  });

  it("draws an image over a scene named beside it, with a warning", () => {
    const { backdrop, problems } = parseBackdrop({ scene: "dots", image: "x.png" });
    expect(backdrop).toEqual({ image: "x.png" });
    expect(problems).toHaveLength(1);
  });
});

describe("mergeBackdrop", () => {
  it("lets settings override the theme field by field, and its appearance override both", () => {
    const merged = mergeBackdrop("dark", { scene: "mesh", opacity: 0.6, dark: { dim: 0.2 } }, { blur: 3, dark: { dim: 0.5 } });
    expect(merged).toEqual({ scene: "mesh", fit: "cover", opacity: 0.6, blur: 3, dim: 0.5 });
  });

  it("replaces the theme's image with a settings scene, and remembers where an image is resolved from", () => {
    expect(mergeBackdrop("light", { image: "bg.png" }, { scene: "dots" })).toMatchObject({ scene: "dots" });
    expect(mergeBackdrop("light", { image: "bg.png" }, undefined)).toMatchObject({ image: "bg.png", imageBase: "theme" });
    expect(mergeBackdrop("light", { scene: "dots" }, { light: { image: "me.png" } })).toMatchObject({ image: "me.png", imageBase: "settings" });
  });

  it("draws nothing for none, or when no layer names anything", () => {
    expect(mergeBackdrop("dark", { scene: "night" }, { scene: "none" })).toBeUndefined();
    expect(mergeBackdrop("dark", { dim: 0.5 }, undefined)).toBeUndefined();
  });
});

describe("backdropScrim", () => {
  const dark = { text: "#F2F2F2", base: "#0A0A0A" };

  it("keeps the person's dim when the backdrop is already readable", () => {
    for (const scene of BACKDROP_SCENES) {
      expect(backdropScrim({ ...dark, sample: sceneSample(scene, dark.base, dark.text), opacity: 1, dim: 0 })).toBe(0);
      expect(backdropScrim({ text: "#161614", base: "#F4F4F1", sample: sceneSample(scene, "#F4F4F1", "#161614"), opacity: 1, dim: 0.35 })).toBe(0.35);
    }
  });

  it("veils a bright image under light text until the text reads at 4.5:1", () => {
    const veil = backdropScrim({ ...dark, sample: "#EEEEEE", opacity: 1, dim: 0 });
    expect(veil).toBeGreaterThan(0.5);
    expect(veil).toBeLessThan(1);
    const shown = mixHex(mixHex(dark.base, "#EEEEEE", 1), dark.base, veil);
    expect(contrastRatio(dark.text, shown)).toBeGreaterThanOrEqual(4.5);
  });

  it("counts opacity, and asks no more of a backdrop than of the bare theme", () => {
    expect(backdropScrim({ ...dark, sample: "#EEEEEE", opacity: 0, dim: 0 })).toBe(0);
    const weak = { text: "#777777", base: "#555555" };
    expect(backdropScrim({ ...weak, sample: "#777777", opacity: 1, dim: 0 })).toBeLessThanOrEqual(1);
    expect(backdropScrim({ ...weak, sample: "#555555", opacity: 1, dim: 0 })).toBe(0);
  });
});
