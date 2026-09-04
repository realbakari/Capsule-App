import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACP_HARNESS_IDS } from "@capsule/shared";
import { OpenClawAdapter } from "./adapter.js";

const temporaryFolders: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(gatewayUrl = "ws://127.0.0.1:18789") {
  const root = await mkdtemp(path.join(os.tmpdir(), "capsule-cwd-wire-"));
  temporaryFolders.push(root);
  const cwd = path.join(root, "Open Source Projects", "Capsule");
  await mkdir(cwd, { recursive: true });
  const adapter = new OpenClawAdapter({ gatewayUrl, cwdAliasRoot: path.join(root, "aliases") });
  const request = vi.fn().mockImplementation(async (method: string) => {
    if (method === "sessions.create") return { key: "agent:main:dashboard:control" };
    return {};
  });
  (adapter as unknown as { client: { request: typeof request } }).client = { request };
  vi.spyOn(adapter, "ensureAcpxPermissionMode").mockResolvedValue({ already: true, applied: false });
  const command = vi.spyOn(adapter, "acpCommand").mockImplementation(async (_parent, text) => {
    const id = text.split(/\s+/)[2];
    return { command: text, text: text.startsWith("/acp spawn ") ? `Spawned ACP session agent:${id}:acp:12345678` : "Updated cwd." };
  });
  return { adapter, cwd, request, command };
}

describe("ACP working-directory aliases on the wire", () => {
  it("uses one literal cwd token for every Gateway harness without changing the original input", async () => {
    const { adapter, cwd, request, command } = await fixture();
    for (const harnessId of ACP_HARNESS_IDS) {
      const input = { harnessId, cwd, title: "My project" };
      const spawned = await adapter.spawnAcpSession(input);
      expect(spawned.sessionKey).toBe(`agent:${harnessId}:acp:12345678`);
      const tokens = spawned.command.split(/\s+/);
      const alias = tokens[tokens.indexOf("--cwd") + 1]!;
      expect(await realpath(alias)).toBe(await realpath(cwd));
      expect(tokens.slice(tokens.indexOf("--cwd") + 2)).toEqual(["--label", "My-project"]);
      expect(input.cwd).toBe(cwd);
    }
    expect(request.mock.calls.some(([method]) => method === "sessions.create")).toBe(true);
    expect(command.mock.calls.some(([, text]) => text.includes("--bind here"))).toBe(false);
  });

  it("uses the same alias for a targeted cwd change through the control session", async () => {
    const { adapter, cwd, command } = await fixture();
    const spawned = await adapter.spawnAcpSession({ harnessId: "claude", cwd });
    const tokens = spawned.command.split(/\s+/);
    const alias = tokens[tokens.indexOf("--cwd") + 1]!;
    await adapter.setAcpOption(spawned.sessionKey, "cwd", cwd);
    expect(command).toHaveBeenLastCalledWith(
      "agent:main:dashboard:control",
      `/acp cwd ${alias} ${spawned.sessionKey}`,
      { waitMs: 6_000, target: spawned.sessionKey },
    );
  });

  it("rejects remote whitespace paths before creating a session or sending commands", async () => {
    const { adapter, cwd, request, command } = await fixture("wss://gateway.example");
    await expect(adapter.spawnAcpSession({ harnessId: "claude", cwd })).rejects.toThrow(/remote Gateway/);
    await expect(adapter.setAcpOption("agent:claude:acp:12345678", "cwd", cwd)).rejects.toThrow(/remote Gateway/);
    expect(request).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    expect(adapter.ensureAcpxPermissionMode).not.toHaveBeenCalled();
  });
});
