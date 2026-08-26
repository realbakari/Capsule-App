import { describe, expect, it } from "vitest";
import { imageMimeFromFilename, languageFromFilename, previewKindFromFilename } from "./preview.js";

describe("file preview kinds", () => {
  it("recognizes images by extension", () => {
    expect(previewKindFromFilename("shots/hero.PNG")).toBe("image");
    expect(imageMimeFromFilename("shots/hero.PNG")).toBe("image/png");
    expect(imageMimeFromFilename("icon.webp")).toBe("image/webp");
  });

  it("maps source files to a language", () => {
    expect(previewKindFromFilename("src/engine.ts")).toBe("text");
    expect(languageFromFilename("src/engine.ts")).toBe("ts");
    expect(languageFromFilename("README.md")).toBe("markdown");
    expect(languageFromFilename("Makefile")).toBe("make");
  });

  it("keeps archives and media as binary", () => {
    expect(previewKindFromFilename("dist/app.zip")).toBe("binary");
    expect(previewKindFromFilename("clip.mp4")).toBe("binary");
  });
});
