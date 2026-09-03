import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const desktopDir = path.join(repoRoot, "apps/desktop");
const tmpRelease = "/tmp/capsule-release";
const finalRelease = path.join(desktopDir, "release");

console.log("==> Preparing packaging environment outside iCloud FileProvider...");
fs.rmSync(tmpRelease, { recursive: true, force: true });
fs.mkdirSync(tmpRelease, { recursive: true });

// 1. Ensure Electron and native modules
console.log("==> Ensuring electron binary...");
execSync("node scripts/ensure-electron.mjs", { cwd: repoRoot, stdio: "inherit" });

// 2. Build renderer, preload, and main
console.log("==> Building application bundle with electron-vite...");
execSync("npx electron-vite build", { cwd: desktopDir, stdio: "inherit" });

// 3. Run electron-builder with output in /tmp/capsule-release to prevent iCloud FileProvider detritus
console.log("==> Running electron-builder with signing and notarization in /tmp...");
execSync(
  `npx electron-builder --mac --arm64 -c.directories.output="${tmpRelease}" --publish never`,
  {
    cwd: desktopDir,
    stdio: "inherit",
    env: process.env,
  }
);

// 4. Copy final artifacts to apps/desktop/release using ditto to preserve symlinks and code signatures
console.log(`==> Copying release artifacts to ${finalRelease}...`);
fs.mkdirSync(finalRelease, { recursive: true });
const files = fs.readdirSync(tmpRelease);
for (const file of files) {
  const src = path.join(tmpRelease, file);
  const dest = path.join(finalRelease, file);
  fs.rmSync(dest, { recursive: true, force: true });
  execSync(`ditto "${src}" "${dest}"`);
}

console.log("\n===========================================");
console.log("✅ Build, Code Signing, and Notarization complete!");
console.log(`Artifacts available at: ${finalRelease}`);
console.log("===========================================\n");
