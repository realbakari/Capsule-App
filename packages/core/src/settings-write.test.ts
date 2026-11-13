import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { CapsuleEngine } from "./engine.js";
import { GATEWAY_TOKEN_ACCOUNT, SKILLS_SH_TOKEN_ACCOUNT } from "./keychain.js";
import { commitWithSecrets } from "./settings-secrets.js";

async function fixture() {
  const profile = mkdtempSync(path.join(tmpdir(), "capsule-settings-write-"));
  const configDir = path.join(profile, "home", ".capsule");
  const engine = new CapsuleEngine({ databasePath: path.join(profile, "state.sqlite"), userDataDir: profile, configDir, autoConnect: false });
  const secrets = new Map<string, string>();
  vi.spyOn(engine.keychain, "get").mockImplementation(async (_service, account) => secrets.get(account));
  const set = vi.spyOn(engine.keychain, "set").mockImplementation(async (_service, account, value) => { secrets.set(account, value); });
  const remove = vi.spyOn(engine.keychain, "delete").mockImplementation(async (_service, account) => { secrets.delete(account); });
  await engine.start();
  await engine.updateSettings({ gatewayToken: "fixture-gateway", skillsShToken: "fixture-catalog" });
  const stored = () => readFileSync(path.join(configDir, "settings.json"), "utf8");
  // A settings folder Capsule cannot write to: the file write fails as a full disk would.
  const failFileWrites = () => chmodSync(configDir, 0o500);
  return { engine, secrets, set, remove, stored, failFileWrites, close: async () => {
    chmodSync(configDir, 0o700);
    await engine.stop();
    rmSync(profile, { recursive: true, force: true });
  } };
}

it.each(["replace", "delete"])("restores credentials and settings after a failed %s save", async (operation) => {
  const { engine, secrets, stored, failFileWrites, close } = await fixture();
  try {
    const settings = engine.getSettings();
    const before = stored();
    const beforeSecrets = new Map(secrets);
    const changed = vi.fn(); engine.events.on("state", changed);
    failFileWrites();
    await expect(engine.updateSettings({ gatewayUrl: "ws://127.0.0.1:19999",
      gatewayToken: operation === "replace" ? "fixture-replacement" : "",
      skillsShToken: operation === "replace" ? "fixture-replacement" : "",
    })).rejects.toThrow("Previous settings were kept");
    expect(engine.getSettings()).toEqual(settings);
    expect(stored()).toBe(before);
    expect(secrets).toEqual(beforeSecrets);
    expect(changed).not.toHaveBeenCalled();
  } finally { await close(); }
});

it("rolls back the first credential when writing the second one fails", async () => {
  const { engine, secrets, set, stored, close } = await fixture();
  try {
    const before = new Map(secrets);
    const file = stored();
    set.mockImplementationOnce(async (_service, account, value) => { secrets.set(account, value); })
      .mockRejectedValueOnce(new Error("Fixture write failure"));
    await expect(engine.updateSettings({ gatewayToken: "fixture-new", skillsShToken: "fixture-new" })).rejects.toThrow("Previous settings were kept");
    expect(secrets).toEqual(before);
    expect(stored()).toBe(file);
  } finally { await close(); }
});

it("keeps derived policy writes and settings in the same database transaction", async () => {
  const { engine, secrets, stored, close } = await fixture();
  try {
    const settings = engine.getSettings();
    const policies = engine.repos.listPolicies();
    const file = stored();
    const beforeSecrets = new Map(secrets);
    const writePolicy = engine.repos.upsertPolicy.bind(engine.repos);
    vi.spyOn(engine.repos, "upsertPolicy").mockImplementationOnce((rule) => {
      writePolicy(rule);
      throw new Error("Fixture partial policy failure");
    });
    await expect(engine.updateSettings({ sandbox: "strict", gatewayToken: "" })).rejects.toThrow("Previous settings were kept");
    expect(engine.getSettings()).toEqual(settings);
    expect(stored()).toBe(file);
    expect(engine.repos.listPolicies()).toEqual(policies);
    expect(secrets).toEqual(beforeSecrets);
  } finally { await close(); }
});

it("serializes saves and publishes each settings patch only after persistence", async () => {
  const { engine, set, stored, close } = await fixture();
  try {
    let finish!: () => void;
    set.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    const initial = engine.getSettings();
    const first = engine.updateSettings({ gatewayUrl: "ws://127.0.0.1:19999", gatewayToken: "fixture-new" });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const second = engine.updateSettings({ transcriptSize: "l" });
    expect(engine.getSettings()).toEqual(initial);
    finish();
    await Promise.all([first, second]);
    expect(engine.getSettings()).toMatchObject({ gatewayUrl: "ws://127.0.0.1:19999", transcriptSize: "l" });
    const file = stored();
    expect(JSON.parse(file)).toMatchObject({ gatewayUrl: "ws://127.0.0.1:19999", transcriptSize: "l" });
    expect(file).not.toContain("fixture-new");
    expect(file).not.toContain("gatewayToken");
  } finally { await close(); }
});

it("reports incomplete credential rollback without exposing adapter errors", async () => {
  const error = new Error("fixture-sensitive-diagnostic");
  await expect(commitWithSecrets({
    get: async () => "fixture-old",
    set: async () => { throw error; },
    delete: async () => {},
  }, [{ account: GATEWAY_TOKEN_ACCOUNT, value: "fixture-new" }, { account: SKILLS_SH_TOKEN_ACCOUNT }], () => {}))
    .rejects.toThrow("Could not save settings or fully restore saved credentials");
});
