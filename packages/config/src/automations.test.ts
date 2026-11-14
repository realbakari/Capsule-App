import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ConfigService, createTrustStore } from "./index.js";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const home = mkdtempSync(path.join(tmpdir(), "capsule-automations-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const project = path.join(home, "project");
  mkdirSync(path.join(project, ".capsule"), { recursive: true });
  let trusted: string | undefined;
  const service = new ConfigService({ userDir: path.join(home, ".capsule"), homeDir: home, lastGoodDir: path.join(home, "last-good"), watch: false,
    trust: createTrustStore({ read: () => trusted, write: (value) => { trusted = value; } }) });
  service.load();
  cleanups.push(() => service.close());
  return { service, project, teamFile: path.join(project, ".capsule", "settings.json"), localFile: path.join(project, ".capsule", "settings.local.json") };
}

const TEAM = { id: "nightly", name: "Nightly", schedule: "RRULE:FREQ=DAILY;BYHOUR=2", command: "flaky-tests", workspace: "worktree" };

it("pauses a project team automation with a copy in your local file, and resuming drops the copy", () => {
  const { service, project, teamFile, localFile } = fixture();
  writeFileSync(teamFile, `// team file\n${JSON.stringify({ automations: [TEAM] }, null, 2)}\n`);
  service.trust(project, true);
  service.reload();
  const entry = service.extended(project).automations[0]!;
  expect(entry.source.scope).toBe("project");
  service.setAutomationEnabled({ automation: entry.value, source: entry.source, enabled: false, root: project });
  expect(readFileSync(teamFile, "utf8")).toContain("// team file");
  expect(JSON.parse(readFileSync(localFile, "utf8")).automations).toEqual([{ ...TEAM, enabled: false }]);
  const paused = service.extended(project).automations[0]!;
  expect(paused).toMatchObject({ value: { enabled: false }, source: { scope: "local" } });
  service.setAutomationEnabled({ automation: paused.value, source: paused.source, enabled: true, root: project });
  expect(JSON.parse(readFileSync(localFile, "utf8")).automations).toBeUndefined();
  expect(service.extended(project).automations[0]!.source.scope).toBe("project");
});
