import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gatewayAcpCwd } from "./acp-cwd.js";

const temporaryFolders: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "capsule-cwd-test-"));
  temporaryFolders.push(root);
  const cwd = path.join(root, "Open Source Projects", "Capsule");
  const aliases = path.join(root, "aliases");
  await mkdir(cwd, { recursive: true });
  return { root, cwd, aliases };
}
afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Gateway working-directory transport", () => {
  it.each(["127.0.0.1", "localhost", "::1", "[::1]"])("preserves the exact folder for %s", async (host) => {
    const { cwd, aliases } = await fixture();
    await writeFile(path.join(cwd, "proof.txt"), "same folder");
    const alias = (await gatewayAcpCwd(cwd, host, aliases))!;
    expect(alias).not.toMatch(/\s/);
    expect(await realpath(alias)).toBe(await realpath(cwd));
    expect(await readFile(path.join(alias, "proof.txt"), "utf8")).toBe("same folder");
    await writeFile(path.join(alias, "proof.txt"), "same file");
    expect(await readFile(path.join(cwd, "proof.txt"), "utf8")).toBe("same file");
    expect((await lstat(aliases)).mode & 0o077).toBe(0);
  });

  it("reuses the same alias across concurrent calls and adapter restarts", async () => {
    const { cwd, aliases } = await fixture();
    const values = await Promise.all(Array.from({ length: 8 }, () => gatewayAcpCwd(cwd, "localhost", aliases)));
    expect(new Set(values).size).toBe(1);
    expect(await gatewayAcpCwd(cwd, "localhost", aliases)).toBe(values[0]);
  });

  it("preserves spaces, Unicode, quotes, backslashes and dollar signs literally", async () => {
    const { root, aliases } = await fixture();
    const cwd = path.join(root, 'my café\tproject "$x" \\ folder');
    await mkdir(cwd);
    const alias = (await gatewayAcpCwd(cwd, "localhost", aliases))!;
    expect(await realpath(alias)).toBe(await realpath(cwd));
  });

  it("does not read or alias a remote host path", async () => {
    const { cwd, aliases } = await fixture();
    await expect(gatewayAcpCwd(cwd, "gateway.example", aliases)).rejects.toThrow(/remote Gateway/);
    await expect(lstat(aliases)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await gatewayAcpCwd("/remote/repo", "gateway.example", aliases)).toBe("/remote/repo");
    expect(await gatewayAcpCwd(undefined, "gateway.example", aliases)).toBeUndefined();
  });

  it("rejects missing and non-directory targets without creating aliases", async () => {
    const { root, aliases } = await fixture();
    await expect(gatewayAcpCwd(path.join(root, "missing folder"), "localhost", aliases)).rejects.toThrow();
    const file = path.join(root, "a file");
    await writeFile(file, "contents");
    await expect(gatewayAcpCwd(file, "localhost", aliases)).rejects.toThrow(/must be a folder/);
    await expect(lstat(aliases)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a redirected alias without replacing it", async () => {
    const { cwd, root, aliases } = await fixture();
    await mkdir(aliases, { mode: 0o700 });
    const name = createHash("sha256").update(await realpath(cwd)).digest("hex");
    const alias = path.join(aliases, name);
    await symlink(root, alias, "dir");
    await expect(gatewayAcpCwd(cwd, "localhost", aliases)).rejects.toThrow(/points somewhere else/);
    expect(await realpath(alias)).toBe(await realpath(root));
  });

  it("refuses a symlink or shared directory as the alias root", async () => {
    const { cwd, root, aliases } = await fixture();
    await symlink(root, aliases, "dir");
    await expect(gatewayAcpCwd(cwd, "localhost", aliases)).rejects.toThrow(/private directory/);
    const shared = path.join(root, "shared");
    await mkdir(shared, { mode: 0o755 });
    await chmod(shared, 0o755); // mkdir's mode is masked by the process umask; force it so the case holds under a restrictive umask.
    await expect(gatewayAcpCwd(cwd, "localhost", shared)).rejects.toThrow(/private directory/);
  });
});
