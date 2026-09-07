import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readProjectIconDataUrl, resolveProjectIconPath } from "./project-icons.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("project icons", () => {
  it("prefers a custom image and otherwise discovers a conventional favicon", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-project-icon-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, "public"));
    fs.writeFileSync(path.join(root, "public", "favicon.png"), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(root, "brand.svg"), "<svg />");

    expect(resolveProjectIconPath(root)).toBe(fs.realpathSync(path.join(root, "public", "favicon.png")));
    expect(resolveProjectIconPath(root, "brand.svg")).toBe(fs.realpathSync(path.join(root, "brand.svg")));
    expect(readProjectIconDataUrl(root, "brand.svg")).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("rejects non-image overrides", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-project-icon-"));
    roots.push(root);
    fs.writeFileSync(path.join(root, "secret.txt"), "not an icon");
    expect(resolveProjectIconPath(root, "secret.txt")).toBeUndefined();
  });

  it("rejects repository icon escapes while allowing an explicitly chosen image", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-project-icon-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "capsule-selected-icon-"));
    roots.push(root, outside);
    const icon = path.join(outside, "favicon.png");
    fs.writeFileSync(icon, Buffer.from([1, 2, 3]));
    fs.symlinkSync(outside, path.join(root, "public"));
    expect(readProjectIconDataUrl(root)).toBeUndefined();
    expect(readProjectIconDataUrl(root, "public/favicon.png")).toBeUndefined();
    expect(readProjectIconDataUrl(root, icon)).toMatch(/^data:image\/png;base64,/);
  });
});
