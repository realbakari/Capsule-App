import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });

async function fixture() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "capsule-open-target-")));
  const root = path.join(dir, "project");
  const outside = path.join(dir, "outside");
  mkdirSync(path.join(root, "src"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(path.join(root, "src", "index.ts"), "export {};\n");
  writeFileSync(path.join(outside, "secret.txt"), "no\n");
  symlinkSync(outside, path.join(root, "escape"));
  const engine = new CapsuleEngine({ databasePath: path.join(dir, "state.sqlite"), userDataDir: dir, autoConnect: false });
  await engine.start();
  cleanup.push(async () => { await engine.stop(); rmSync(dir, { recursive: true, force: true }); });
  const project = engine.createProject({ name: "Open target fixture", workingDirectory: root });
  const session = await engine.createSession({ projectId: project.id, mode: "chat" });
  return { engine, project, session, root, outside };
}

it("opens the conversation's folder and files inside it", async () => {
  const { engine, project, session, root } = await fixture();
  expect(engine.resolveOpenTarget(project.id, session.id)).toBe(root);
  expect(engine.resolveOpenTarget(project.id, session.id, "src/index.ts")).toBe(path.join(root, "src", "index.ts"));
  expect(engine.resolveOpenTarget(project.id, undefined, path.join(root, "src"))).toBe(path.join(root, "src"));
});

it("refuses paths outside the project's folders, through a symlink too", async () => {
  const { engine, project, session, outside } = await fixture();
  expect(() => engine.resolveOpenTarget(project.id, session.id, outside)).toThrow(/not inside this project/);
  expect(() => engine.resolveOpenTarget(project.id, session.id, "../outside/secret.txt")).toThrow(/not inside this project/);
  expect(() => engine.resolveOpenTarget(project.id, session.id, "escape/secret.txt")).toThrow(/not inside this project/);
  expect(() => engine.resolveOpenTarget(project.id, session.id, "missing.txt")).toThrow(/not inside this project/);
});
