import { describe, expect, it } from "vitest";
import {
  appearanceCssVars,
  clampContrast,
  inkOn,
  isDarkColor,
  mixHex,
  normalizeAppearancePalette,
  normalizeHexColor,
} from "./appearance.js";

describe("appearance palettes", () => {
  it("normalizes hex colors and contrast", () => {
    expect(normalizeHexColor("339cff", "#000000")).toBe("#339CFF");
    expect(normalizeHexColor("nope", "#181818")).toBe("#181818");
    expect(clampContrast(142)).toBe(100);
    expect(clampContrast(-4)).toBe(0);
  });

  it("mixes colors and picks readable ink", () => {
    expect(mixHex("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(isDarkColor("#181818")).toBe(true);
    expect(inkOn("#F3F3EE")).toBe("#111111");
    expect(inkOn("#1A1C1F")).toBe("#FFFFFF");
    expect(inkOn("#FFFFFF")).toBe("#111111");
  });

  it("emits CSS variables for a dark palette", () => {
    const vars = appearanceCssVars(
      normalizeAppearancePalette(
        {
          accent: "#F3F3EE",
          background: "#181818",
          foreground: "#FFFFFF",
          contrast: 45,
          translucentSidebar: true,
        },
        {
          accent: "#F3F3EE",
          background: "#181818",
          foreground: "#FFFFFF",
          contrast: 45,
          translucentSidebar: true,
          uiFont: "system",
          codeFont: "sf-mono",
        },
      ),
    );
    expect(vars["--accent"]).toBe("#F3F3EE");
    expect(vars["--bg"]).toBe("#181818");
    expect(vars["--text"]).toBe("#FFFFFF");
    expect(vars["--sidebar-filter"]).toContain("blur");
  });
});
