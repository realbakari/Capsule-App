import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["scripts/test.mjs", "packages/codex", "packages/acp", "packages/harness",
  "packages/core/src/codex-flow.test.ts", "packages/core/src/muse-flow.test.ts", "packages/core/src/local-startup.test.ts",
  "packages/shared/src/ipc-scopes.test.ts"], { stdio: "inherit" });
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
