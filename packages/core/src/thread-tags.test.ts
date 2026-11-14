import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

it("keeps tags across a restart, and renames and deletes them on every thread", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "capsule-tags-"));
  const databasePath = path.join(directory, "capsule.sqlite");
  const open = async () => {
    const engine = new CapsuleEngine({ databasePath, userDataDir: directory, autoConnect: false });
    await engine.start();
    return engine;
  };
  try {
    let engine = await open();
    const one = engine.createProject({ name: "One", workingDirectory: directory });
    const two = engine.createProject({ name: "Two", workingDirectory: directory });
    const first = await engine.createSession({ projectId: one.id });
    const second = await engine.createSession({ projectId: two.id });
    expect(engine.setSessionTags(first.id, ["#Bug", "ui", "UI"]).tags).toEqual(["bug", "ui"]);
    engine.setSessionTags(second.id, ["ui"]);
    // A turn's ordinary update must not drop the tags.
    engine.renameSession(first.id, "Renamed");
    await engine.stop();

    engine = await open();
    const tagsOf = (id: string) => engine.listSessions().find((item) => item.id === id)?.tags;
    expect(tagsOf(first.id)).toEqual(["bug", "ui"]);
    expect(engine.renameTag("UI", "frontend")).toBe(2);
    expect(tagsOf(first.id)).toEqual(["bug", "frontend"]);
    expect(tagsOf(second.id)).toEqual(["frontend"]);
    expect(engine.renameTag("bug", "frontend")).toBe(1);
    expect(tagsOf(first.id)).toEqual(["frontend"]);
    expect(engine.deleteTag("frontend")).toBe(2);
    expect(tagsOf(first.id)).toBeUndefined();
    expect(tagsOf(second.id)).toBeUndefined();
    await engine.stop();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
