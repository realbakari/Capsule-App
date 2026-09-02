import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:*; img-src 'self' data:; object-src 'none'; base-uri 'self';";
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: http://127.0.0.1:* http://localhost:*; img-src 'self' data:; object-src 'none'; base-uri 'self';";

function contentSecurityPolicy(): Plugin {
  return {
    name: "capsule-csp",
    transformIndexHtml(html, ctx) {
      const policy = ctx.server ? DEV_CSP : PROD_CSP;
      return html.replace(/content="default-src[^"]*"/, `content="${policy}"`);
    },
  };
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@capsule/core",
          "@capsule/shared",
          "@capsule/database",
          "@capsule/projects",
          "@capsule/sessions",
          "@capsule/agents",
          "@capsule/skills",
          "@capsule/tools",
          "@capsule/runs",
          "@capsule/policies",
          "@capsule/contracts",
          "@capsule/verification",
          "@capsule/artifacts",
          "@capsule/filesystem",
          "@capsule/terminal",
          "@capsule/openclaw",
          "@capsule/harness",
          "@capsule/buzz",
          "@capsule/ui",
        ],
        /* Native modules stay external: bundling them rewrites the dynamic
           require that loads the .node binary, and the app dies at startup. */
        include: [
          "better-sqlite3",
          "node-pty",
          "@openclaw/gateway-client",
          "@openclaw/gateway-protocol",
          "ws",
        ],
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@capsule/shared"],
      }),
    ],
    build: {
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react(), contentSecurityPolicy()],
  },
});
