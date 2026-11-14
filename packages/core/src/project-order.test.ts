import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleEngine } from "./engine.js";

describe("project order", () => {
  it("keeps the dragged order, lists new projects first, and refuses a stale order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-order-"));
    const engine = new CapsuleEngine({ databasePath: path.join(dir, "capsule.sqlite"), userDataDir: dir, autoConnect: false });
    await engine.start();
    try {
      const a = engine.createProject({ name: "A" });
      const b = engine.createProject({ name: "B" });
      const c = engine.createProject({ name: "C" });
      const names = () => engine.listProjects().filter((project) => ["A", "B", "C", "D"].includes(project.name)).map((project) => project.name);
      const others = engine.listProjects().filter((project) => !["A", "B", "C"].includes(project.name)).map((project) => project.id);
      engine.reorderProjects([b.id, a.id, c.id, ...others]);
      expect(names()).toEqual(["B", "A", "C"]);
      engine.createProject({ name: "D" });
      expect(names()).toEqual(["D", "B", "A", "C"]);
      expect(() => engine.reorderProjects([a.id, a.id])).toThrow(/out of date/);
      expect(() => engine.reorderProjects(["missing"])).toThrow(/out of date/);
    } finally {
      await engine.stop();
    }
  });
});
