// Focused, repeatable privacy and remote-control gate. All profiles are disposable.
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["scripts/test.mjs", "packages/remote",
  "packages/shared/src/ipc-scopes.test.ts", "apps/desktop/src/main/remote-control.test.ts",
  "apps/desktop/src/main/remote-flow.test.ts",
  "apps/desktop/src/main/analytics.test.ts", "apps/desktop/src/renderer/src/lib/remote-bridge.test.ts",
  "scripts/renderer-regressions.test.mjs"], { stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
