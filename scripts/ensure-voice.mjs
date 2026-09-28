import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "darwin") {
  const native = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/desktop/native");
  const source = path.join(native, "Voice.swift"), info = path.join(native, "Voice-Info.plist"), binary = path.join(native, "capsule-voice");
  let current = false;
  try { current = statSync(binary).mtimeMs > Math.max(statSync(source).mtimeMs, statSync(info).mtimeMs, statSync(fileURLToPath(import.meta.url)).mtimeMs); } catch { /* First build. */ }
  if (!current) {
    const cache = path.resolve(native, "../../../.cache/swift");
    mkdirSync(cache, { recursive: true });
    const target = `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos12.0`;
    const result = spawnSync("xcrun", ["swiftc", "-swift-version", "5", "-target", target, "-module-cache-path", cache, "-O", source, "-o", binary,
      "-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", info], { stdio: "inherit" });
    if (result.error || result.status !== 0) throw new Error("Could not build the companion voice helper. Install the macOS command-line developer tools.");
  }
}
