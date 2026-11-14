import { describe, expect, it } from "vitest";
import { expandMcpSecrets, isMcpServerPatch, mcpDelivery, mcpServerStatus } from "./mcp.js";

const context = { home: "/Users/me", env: { TOKEN: "s3cret" } as Record<string, string | undefined> };

describe("mcpServerStatus", () => {
  it("offers an enabled server everywhere when it names no projects", () => {
    expect(mcpServerStatus("docs", { command: "docs-mcp" }, context)).toEqual({ state: "offered" });
  });

  it("keeps a turned-off server off", () => {
    expect(mcpServerStatus("docs", { command: "docs-mcp", enabled: false }, context).state).toBe("off");
  });

  it("matches projects globs against the project folder, with ~ for home", () => {
    const server = { url: "https://db.example/mcp", projects: ["~/work/*"] };
    expect(mcpServerStatus("db", server, { ...context, root: "/Users/me/work/api" })).toEqual({ state: "offered" });
    expect(mcpServerStatus("db", server, { ...context, root: "/Users/me/play/api" })).toMatchObject({ state: "off", reason: "project" });
    expect(mcpServerStatus("db", server, context)).toMatchObject({ state: "off", reason: "project" });
  });

  it("honours a profile's mcp list", () => {
    expect(mcpServerStatus("db", { command: "x" }, { ...context, profileMcp: ["docs"] })).toMatchObject({ state: "off", reason: "profile" });
    expect(mcpServerStatus("docs", { command: "x" }, { ...context, profileMcp: ["docs"] })).toEqual({ state: "offered" });
  });

  it("holds a server whose secret variable is not set", () => {
    expect(mcpServerStatus("db", { url: "https://x", headers: { Authorization: "Bearer ${env:MISSING}" } }, context)).toEqual({ state: "needs-env", missing: ["MISSING"] });
  });

  it("refuses a name an agent's configuration could not hold", () => {
    expect(mcpServerStatus("my.server", { command: "x" }, context)).toMatchObject({ state: "off", reason: "name" });
  });
});

describe("expandMcpSecrets", () => {
  it("expands env and headers values only", () => {
    expect(expandMcpSecrets({ command: "run ${env:TOKEN}", env: { KEY: "${env:TOKEN}" } }, context.env).config)
      .toEqual({ command: "run ${env:TOKEN}", env: { KEY: "s3cret" } });
    expect(expandMcpSecrets({ url: "https://x", headers: { Authorization: "Bearer ${env:TOKEN}" } }, context.env).config)
      .toEqual({ url: "https://x", headers: { Authorization: "Bearer s3cret" } });
  });
});

describe("mcpDelivery", () => {
  it("answers per harness and route", () => {
    expect(mcpDelivery("claude", "gateway")).toMatchObject({ stdio: "not-carried", http: "not-carried" });
    expect(mcpDelivery("claude", "direct")).toMatchObject({ stdio: "carried", http: "carried" });
    expect(mcpDelivery("codex", "direct")).toMatchObject({ stdio: "carried", http: "carried" });
    expect(mcpDelivery("grok", "direct")).toMatchObject({ stdio: "carried", http: "if-reported" });
    expect(mcpDelivery("muse", "direct")).toMatchObject({ stdio: "not-carried" });
  });

  it("tells a patch from a definition", () => {
    expect(isMcpServerPatch({ enabled: false })).toBe(true);
    expect(isMcpServerPatch({ url: "https://x" })).toBe(false);
  });
});
