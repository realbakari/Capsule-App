import { expect, it } from "vitest";
import { codexMcpConfig } from "./mcp.js";

it("sets each offered server under its own key, so the person's own servers stay", () => {
  expect(codexMcpConfig([
    { name: "docs", command: "docs-mcp", args: ["--stdio"], env: [{ name: "TOKEN", value: "t" }], cwd: "/srv" },
    { type: "http", name: "capsule-browser", url: "http://127.0.0.1:9/mcp", headers: [{ name: "Authorization", value: "Bearer x" }] },
  ])).toEqual({
    "mcp_servers.docs": { command: "docs-mcp", args: ["--stdio"], env: { TOKEN: "t" }, cwd: "/srv" },
    "mcp_servers.capsule-browser": { url: "http://127.0.0.1:9/mcp", http_headers: { Authorization: "Bearer x" } },
  });
});
