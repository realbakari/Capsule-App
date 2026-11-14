import { describe, expect, it } from "vitest";
import { appearanceCssVars, DEFAULT_DARK_PALETTE, DEFAULT_LIGHT_PALETTE, type ThemeSummary } from "@capsule/shared";
import { backdropPaint, pageColours, themeVars, worstSample } from "./theme-apply";

const summary = (overrides: Partial<ThemeSummary>): ThemeSummary => ({
  id: "x", name: "X", appearance: "dark", source: "user", builtin: false, tokens: {}, problems: [], contrast: [], ...overrides,
});

describe("themeVars", () => {
  it("leaves the built-in themes to the palette, exactly as before themes existed", () => {
    const builtin = summary({ id: "capsule-light", appearance: "light", builtin: true });
    expect(themeVars(DEFAULT_LIGHT_PALETTE, builtin)).toEqual(appearanceCssVars(DEFAULT_LIGHT_PALETTE));
    expect(themeVars(DEFAULT_LIGHT_PALETTE, undefined)).toEqual(appearanceCssVars(DEFAULT_LIGHT_PALETTE));
  });

  it("lets another theme colour the palette's derived variables and then set its own tokens", () => {
    const harbor = summary({ tokens: { base: "#0e151e", text: "#e6edf5", accent: "#7fb4e6", mantle: "#0c121a" } });
    const vars = themeVars({ ...DEFAULT_DARK_PALETTE, uiFont: "serif" }, harbor);
    expect(vars["--bg"]).toBe("#0e151e");
    expect(vars["--base"]).toBe("#0e151e");
    expect(vars["--mantle"]).toBe("#0c121a");
    expect(vars["--bg-elevated"]).not.toBe(appearanceCssVars(DEFAULT_DARK_PALETTE)["--bg-elevated"]);
    expect(vars["--font"]).toContain("Palatino");
  });

  it("applies overrides on a built-in theme over its palette", () => {
    const vars = themeVars(DEFAULT_DARK_PALETTE, summary({ id: "capsule-dark", builtin: true, tokens: { red: "#ff0000" } }));
    expect(vars["--red"]).toBe("#ff0000");
    expect(vars["--bg"]).toBe(DEFAULT_DARK_PALETTE.background);
  });
});

describe("backdropPaint", () => {
  const page = pageColours({ "--bg": "#0a0a0a", "--text": "oklch(0.96 0 0)" }, "dark");

  it("reads page colours as hex, whatever form the theme wrote", () => {
    expect(page.base).toBe("#0A0A0A");
    expect(page.text).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("draws a scene with the person's dim when it is already readable", () => {
    expect(backdropPaint({ scene: "dots", fit: "cover", opacity: 0.8, blur: 2, dim: 0.1 }, page, { images: true })).toEqual({
      mode: "dots",
      vars: { "--backdrop-opacity": "0.8", "--backdrop-blur": "2px", "--backdrop-veil": "0.1" },
    });
  });

  it("veils an image for the worst case until it has been sampled, and less once a dark sample arrives", () => {
    const view = { imageUrl: "capsule-backdrop://image/abc.png", fit: "tile" as const, opacity: 1, blur: 0, dim: 0 };
    const unsampled = backdropPaint(view, page, { images: true });
    expect(unsampled.mode).toBe("image");
    expect(Number(unsampled.vars["--backdrop-veil"])).toBeGreaterThan(0.5);
    expect(unsampled.vars).toMatchObject({ "--backdrop-size": "auto", "--backdrop-repeat": "repeat", "--backdrop-image": 'url("capsule-backdrop://image/abc.png")' });
    expect(Number(backdropPaint(view, page, { images: true, sample: "#202020" }).vars["--backdrop-veil"])).toBe(0);
  });

  it("draws no image where images are not served, such as a paired device", () => {
    expect(backdropPaint({ imageUrl: "capsule-backdrop://image/abc.png", fit: "cover", opacity: 1, blur: 0, dim: 0 }, page, { images: false })).toEqual({ vars: {} });
  });
});

describe("worstSample", () => {
  it("picks the pixel nearest the text and skips transparent ones", () => {
    const pixels = [10, 10, 10, 255, 240, 240, 240, 255, 255, 255, 255, 0];
    expect(worstSample(pixels, "#FFFFFF")).toBe("#F0F0F0");
    expect(worstSample([0, 0, 0, 0], "#FFFFFF")).toBeUndefined();
  });
});
