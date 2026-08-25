import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import { app, dialog } from "electron";

function loadSqlite(): Error | undefined {
  try {
    createRequire(import.meta.url)("better-sqlite3");
    return undefined;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function repoRoot(): string {
  return path.resolve(__dirname, "../../../..");
}

function rebuildNative(): Promise<void> {
  const script = path.join(repoRoot(), "scripts/ensure-native.mjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: repoRoot(),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ensure-native.mjs exited ${code}`));
    });
    child.on("error", reject);
  });
}

export async function ensureSqliteAbi(): Promise<void> {
  const first = loadSqlite();
  if (!first) return;
  if (!first.message.includes("NODE_MODULE_VERSION")) throw first;

  if (app.isPackaged) {
    dialog.showErrorBox(
      "Capsule needs a native rebuild",
      "SQLite was compiled for a different Node.js ABI than this Electron build.",
    );
    throw first;
  }

  console.warn("better-sqlite3 ABI mismatch; rebuilding for Electron…");
  await rebuildNative();
  app.relaunch();
  app.exit(0);
}
