import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DirectAcpHost } from "./host.js";
import { DirectAcpSession, type DirectAcpOptions } from "./session.js";

describe("a direct agent's launch", () => {
  it("runs the user's binary with their extra arguments and environment, keeping the preset's launch identity", async () => {
    let launched: DirectAcpOptions | undefined;
    const start = vi.spyOn(DirectAcpSession.prototype, "start").mockImplementation(function (this: DirectAcpSession) {
      launched = (this as unknown as { options: DirectAcpOptions }).options;
      return Promise.reject(new Error("launch captured"));
    });
    const host = new DirectAcpHost(
      undefined,
      (command, harnessId) => (harnessId === "grok" ? `/custom/${command}` : command),
      (harnessId) => (harnessId === "grok" ? { args: ["--profile", "work"], env: { GROK_HOME: "/custom/home" } } : { args: [] }),
    );
    try {
      await expect(host.spawnAcpSession({ harnessId: "grok", cwd: path.resolve(".") })).rejects.toThrow("launch captured");
      expect(launched?.command).toMatch(/^\/custom\//);
      expect(launched?.args.slice(-2)).toEqual(["--profile", "work"]);
      expect(launched?.env?.GROK_HOME).toBe("/custom/home");
      expect(launched?.env?.PATH).toBe(process.env.PATH);
    } finally {
      start.mockRestore();
    }
  });

  it("leaves the environment alone when the user set none", async () => {
    let launched: DirectAcpOptions | undefined;
    const start = vi.spyOn(DirectAcpSession.prototype, "start").mockImplementation(function (this: DirectAcpSession) {
      launched = (this as unknown as { options: DirectAcpOptions }).options;
      return Promise.reject(new Error("launch captured"));
    });
    try {
      await expect(new DirectAcpHost().spawnAcpSession({ harnessId: "grok", cwd: path.resolve(".") })).rejects.toThrow("launch captured");
      expect(launched?.env).toBeUndefined();
    } finally {
      start.mockRestore();
    }
  });
});
