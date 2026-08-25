import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

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
          "@capsule/buzz",
          "@capsule/ui",
        ],
        include: ["better-sqlite3", "@openclaw/gateway-client", "@openclaw/gateway-protocol", "ws"],
      }),
    ],
  },
  preload: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ["@capsule/shared"],
      }),
    ],
  },
  renderer: {
    resolve: {
      alias: {
        "@renderer": resolve("src/renderer/src"),
      },
    },
    plugins: [react()],
  },
});
