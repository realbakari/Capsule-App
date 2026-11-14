import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { encodeThemeShareString, MAX_BACKDROP_IMAGE_BYTES } from "@capsule/shared";
import { editKeybindingsText } from "./keybindings.js";
import { ConfigService } from "./service.js";
import { createTrustStore } from "./trust.js";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-themes-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const userDir = path.join(home, ".capsule");
  const project = path.join(home, "project");
  mkdirSync(project, { recursive: true });
  const write = (file: string, text: string | Buffer) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const open = () => {
    let trusted: string | undefined;
    const service = new ConfigService({ userDir, lastGoodDir: path.join(home, "last-good"), trust: createTrustStore({ read: () => trusted, write: (v) => { trusted = v; } }), watch: false });
    service.load();
    cleanups.push(() => service.close());
    return service;
  };
  return { home, userDir, project, write, open, settings: path.join(userDir, "settings.json") };
}

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

describe("themes", () => {
  it("lists bundled, user and project themes, with overrides on top and each file's problems", () => {
    const { userDir, project, write, open, settings } = fixture();
    write(path.join(userDir, "themes", "dusk.json"), `{ // mine
      "name": "Dusk", "appearance": "dark", "tokens": { "base": "#101820", "text": "#e0e0e0" }, "colours": 1 }`);
    write(path.join(project, ".capsule", "themes", "team.json"), JSON.stringify({ name: "Team", appearance: "light" }));
    write(path.join(userDir, "themes", "broken.json"), "{ nope");
    write(settings, JSON.stringify({ theme: { dark: "dusk" }, themeOverrides: { dusk: { accent: "#ff8800" } } }));
    const service = open();
    const state = service.themes(project);
    expect(state.dark).toBe("dusk");
    const dusk = state.themes.find((t) => t.id === "dusk")!;
    expect(dusk).toMatchObject({ source: "user", builtin: false, tokens: { base: "#101820", text: "#e0e0e0", accent: "#ff8800" } });
    expect(state.themes.find((t) => t.id === "team")?.source).toBe("project");
    expect(state.themes.find((t) => t.id === "capsule-light")?.builtin).toBe(true);
    const problems = service.diagnostics(project).problems.filter((p) => p.path.includes(`${path.sep}themes${path.sep}`));
    expect(problems.map((p) => [p.severity, path.basename(p.path)])).toEqual([["error", "broken.json"], ["warning", "dusk.json"]]);
  });

  it("falls back to the built-in for an unknown id or the wrong appearance, and says so", () => {
    const { write, open, settings } = fixture();
    write(settings, JSON.stringify({ theme: { light: "harbor", dark: "missing" } }));
    const service = open();
    expect(service.themes()).toMatchObject({ light: "capsule-light", dark: "capsule-dark" });
    expect(service.diagnostics().problems.map((p) => p.key)).toEqual(expect.arrayContaining(["theme.light", "theme.dark"]));
  });

  it("serves a backdrop image only from the settings folder or the theme's folder", () => {
    const { home, userDir, write, open, settings } = fixture();
    write(path.join(userDir, "backdrops", "sky.png"), PNG);
    write(path.join(home, "elsewhere.png"), PNG);
    symlinkSync(path.join(home, "elsewhere.png"), path.join(userDir, "backdrops", "link.png"));
    write(path.join(userDir, "backdrops", "notes.txt"), "x");
    write(path.join(userDir, "backdrops", "huge.png"), Buffer.alloc(MAX_BACKDROP_IMAGE_BYTES + 1));
    const service = open();
    const shown = (image: string) => {
      write(settings, JSON.stringify({ theme: { backdrop: { image, dim: 0.2 } } }));
      service.reload();
      return service.themes().backdrop.dark;
    };
    const ok = shown("backdrops/sky.png")!;
    expect(ok).toMatchObject({ imageName: "sky.png", dim: 0.2, imageUrl: expect.stringMatching(/^capsule-backdrop:\/\/image\/[0-9a-f]{24}\.png$/) });
    expect(service.backdropImage(ok.imageUrl!.split("/").pop()!)).toBe(path.join(userDir, "backdrops", "sky.png").replace(/^\/var\//, "/private/var/"));
    for (const image of ["../elsewhere.png", "backdrops/link.png", "backdrops/notes.txt", "backdrops/huge.png", "backdrops/gone.png"]) {
      expect(shown(image)).toBeUndefined();
    }
    expect(service.diagnostics().problems.filter((p) => p.key === "backdrop.image")).toHaveLength(1);
  });

  it("reads a theme's own backdrop image beside the theme file, and lets settings turn it off", () => {
    const { userDir, write, open, settings } = fixture();
    write(path.join(userDir, "themes", "pic", "pic.json"), JSON.stringify({ name: "Pic", appearance: "light", backdrop: { image: "bg.png", opacity: 0.5 } }));
    write(path.join(userDir, "themes", "pic", "bg.png"), PNG);
    write(settings, JSON.stringify({ theme: { light: "pic/pic" } }));
    const service = open();
    expect(service.themes().backdrop.light).toMatchObject({ imageName: "bg.png", opacity: 0.5 });
    write(settings, JSON.stringify({ theme: { light: "pic/pic", backdrop: { scene: "none" } } }));
    service.reload();
    expect(service.themes().backdrop.light).toBeUndefined();
  });

  it("imports a share string and a file, and never keeps an image path", () => {
    const { userDir, open } = fixture();
    const service = open();
    const share = encodeThemeShareString({ id: "x", name: "Night Owl", appearance: "dark", tokens: { base: "#000000" }, backdrop: { scene: "night" } });
    const first = service.importTheme({ kind: "share", text: share });
    expect(first).toMatchObject({ id: "night-owl", appearance: "dark" });
    expect(service.importTheme({ kind: "share", text: share }).id).toBe("night-owl-2");
    expect(service.themes().themes.map((t) => t.id)).toContain("night-owl-2");
    const file = service.importTheme({ kind: "file", name: "Sunny Day.json", text: JSON.stringify({ name: "Sunny", appearance: "light", backdrop: { image: "/tmp/x.png", dim: 0.1 } }) });
    expect(file.id).toBe("sunny-day");
    expect(file.problems.map((p) => p.key)).toContain("backdrop.image");
    expect(JSON.parse(readFileSync(path.join(userDir, "themes", "sunny-day.json"), "utf8")).backdrop).toEqual({ dim: 0.1 });
    expect(() => service.importTheme({ kind: "share", text: "capsule-theme:zzz" })).toThrow();
    expect(() => service.importTheme({ kind: "file", name: "a.json", text: JSON.stringify({ name: "A" }) })).toThrow(/appearance/);
  });

  it("copies a chosen image into backdrops and draws it in place of the scene", () => {
    const { home, userDir, write, open, settings } = fixture();
    write(path.join(home, "Pictures", "My Sky.png"), PNG);
    write(settings, JSON.stringify({ theme: { dark: "harbor", backdrop: { scene: "dots", dim: 0.4 } } }));
    const service = open();
    service.importBackdropImage(path.join(home, "Pictures", "My Sky.png"));
    expect(JSON.parse(readFileSync(settings, "utf8")).theme).toEqual({ dark: "harbor", backdrop: { dim: 0.4, image: "backdrops/My-Sky.png" } });
    expect(readFileSync(path.join(userDir, "backdrops", "My-Sky.png"))).toEqual(PNG);
    expect(() => service.importBackdropImage(path.join(userDir, "settings.json"))).toThrow(/png/);
  });
});

describe("keybindings.json", () => {
  it("binds, unbinds and resets in place, keeping comments", () => {
    const text = `[
  // My keys.
  {
    "context": "global",
    "bindings": {
      // chord
      "cmd+g cmd+t": "toggle-terminal",
      "ctrl+b": "toggle-sidebar"
    }
  }
]
`;
    const rebound = editKeybindingsText(text, { op: "bind", action: "toggle-sidebar", context: "global", sequence: "Cmd+Shift+L" });
    expect(rebound).toContain("// My keys.");
    expect(rebound).toContain("// chord");
    expect(rebound).toContain('"cmd+shift+l": "toggle-sidebar"');
    expect(rebound).not.toContain("ctrl+b");

    const unbound = editKeybindingsText(rebound, { op: "unbind", context: "global", sequence: "cmd+p" });
    expect(unbound).toContain('"cmd+p": null');
    expect(editKeybindingsText(rebound, { op: "unbind", context: "global", sequence: "cmd+j" })).toBe(rebound);
    const dropped = editKeybindingsText(unbound, { op: "unbind", context: "global", sequence: "cmd+g cmd+t" });
    expect(dropped).not.toContain("cmd+g cmd+t");

    const composer = editKeybindingsText(dropped, { op: "bind", action: "command:review", context: "composer", sequence: "alt+r" });
    expect(JSON.parse(composer.replace(/\/\/.*$/gm, ""))).toEqual([
      { context: "global", bindings: { "cmd+shift+l": "toggle-sidebar", "cmd+p": null } },
      { context: "composer", bindings: { "alt+r": "command:review" } },
    ]);

    const reset = editKeybindingsText(composer, { op: "reset", action: "search-files", context: "global" });
    expect(reset).not.toContain('"cmd+p": null');
    expect(reset).toContain("// My keys.");
  });

  it("starts an empty file and refuses one that is not a list", () => {
    expect(JSON.parse(editKeybindingsText("", { op: "bind", action: "toggle-sidebar", context: "global", sequence: "cmd+e" }))).toEqual([
      { context: "global", bindings: { "cmd+e": "toggle-sidebar" } },
    ]);
    expect(() => editKeybindingsText("{}", { op: "reset", action: "x", context: "global" })).toThrow(/list/);
  });

  it("reports parse problems and warnings from the file, and refuses to write a broken one", () => {
    const { userDir, write, open } = fixture();
    write(path.join(userDir, "keybindings.json"), JSON.stringify([{ bindings: { "cmd+k cmd+t": "toggle-terminal", "cmd+e": "profile:fast", "hyper+x": "palette" } }]));
    const service = open();
    expect(service.keybindings()).toHaveLength(2);
    const messages = service.diagnostics().problems.filter((p) => p.path.endsWith("keybindings.json")).map((p) => p.severity);
    expect(messages).toEqual(["error", "warning", "warning"]);
    write(path.join(userDir, "keybindings.json"), "[ {");
    service.reload();
    expect(() => service.editKeybindings({ op: "reset", action: "x", context: "global" })).toThrow(/line 1/);
  });

  it("notices an edited theme file on reload", () => {
    const { userDir, write, open } = fixture();
    const service = open();
    write(path.join(userDir, "themes", "a.json"), JSON.stringify({ name: "A", appearance: "dark" }));
    expect(service.reload()).toBe(true);
    expect(service.reload()).toBe(false);
  });
});
