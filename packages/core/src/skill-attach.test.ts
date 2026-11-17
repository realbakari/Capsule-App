import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { MockAgentRuntime } from "@capsule/openclaw";
import type { Skill } from "@capsule/shared";
import { CapsuleEngine } from "./engine.js";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(profile: string) {
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir: path.join(profile, "home", ".capsule"), autoConnect: false });
  for (const method of ["get", "set", "delete"] as const) vi.spyOn(engine.keychain, method).mockResolvedValue(undefined);
  await engine.start();
  return engine;
}

function profileDir() {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-skill-attach-"));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  return profile;
}

it("sends a skill only when one is attached, with the folder its files live in", async () => {
  const profile = profileDir();
  const root = path.join(profile, "project");
  const folder = path.join(root, ".claude", "skills", "release-notes");
  mkdirSync(path.join(folder, "scripts"), { recursive: true });
  writeFileSync(path.join(folder, "SKILL.md"), "---\nname: release-notes\ndescription: Draft release notes\n---\nRun scripts/collect.sh first.\n");
  const engine = await open(profile);
  cleanups.push(() => engine.stop());
  const project = engine.createProject({ name: "Skill fixture", workingDirectory: root });
  const sent = vi.spyOn(MockAgentRuntime.prototype, "sendMessage");

  const plain = await engine.createSession({ projectId: project.id, mode: "code", agentId: "general" });
  const first = await engine.sendMessage({ sessionId: plain.id, content: "Fix the build", mode: "code", agentId: "general" });
  expect(sent.mock.calls.at(-1)?.[0].content).not.toContain("[Active Skill");
  expect(engine.listRunEvents(first.run.id).find((event) => event.type === "skill")?.message).toBe("No skill override");

  const skill = (await engine.listSkills(project.id)).find((entry) => entry.name === "release-notes")!;
  const thread = await engine.createSession({ projectId: project.id, mode: "code", agentId: "general" });
  await engine.sendMessage({ sessionId: thread.id, content: "Write them", mode: "code", agentId: "general", skillId: skill.id });
  const content = sent.mock.calls.at(-1)?.[0].content ?? "";
  expect(content).toContain("[Active Skill: release-notes]");
  expect(content).toContain(`Skill folder: ${path.dirname(skill.location!)}`);
  expect(content).toContain("Run scripts/collect.sh first.");
});

it("drops stored skills that cannot be attached and keeps catalog installs", async () => {
  const profile = profileDir();
  const base: Omit<Skill, "id" | "name"> = { description: "", source: "capsule", status: "installed", requirements: [], permissions: {} };
  const first = await open(profile);
  first.repos.upsertSkill({ ...base, id: "coding", name: "Coding", content: "# Coding Skill" });
  first.repos.upsertSkill({ ...base, id: "acpx", name: "acpx", source: "openclaw" });
  first.repos.upsertSkill({ ...base, id: "owner/repo/review", name: "review", source: "owner/repo", content: "# Review" });
  await first.stop();

  const engine = await open(profile);
  cleanups.push(() => engine.stop());
  expect(engine.repos.listSkills().map((skill) => skill.id)).toEqual(["owner/repo/review"]);
});
