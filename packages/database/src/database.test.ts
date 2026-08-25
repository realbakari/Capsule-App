import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CapsuleDatabase } from "./database.js";
import { CapsuleRepositories } from "./repositories.js";

describe("CapsuleDatabase", () => {
  it("migrates and persists a project", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-db-"));
    const db = new CapsuleDatabase(path.join(dir, "capsule.sqlite"));
    const repos = new CapsuleRepositories(db);
    repos.insertWorkspace({
      id: "ws_1",
      name: "Local",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    repos.insertProject({
      id: "proj_1",
      workspaceId: "ws_1",
      name: "Demo",
      defaultSkillIds: ["coding"],
      defaultMode: "code",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const projects = repos.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]?.name).toBe("Demo");
    expect(projects[0]?.defaultSkillIds).toEqual(["coding"]);
    db.close();
  });
});
