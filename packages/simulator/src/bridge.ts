import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { stopChild } from "@capsule/process";
import { run } from "./simctl.js";

/**
 * The desktop side of Capsule's touch bridge: an XCUITest bundle under
 * `native/simulator-bridge` that Xcode builds once per Xcode version and runs
 * once per device. The runner serves HTTP on a loopback port this process
 * picks, behind a token minted for that launch, and turns each command into a
 * public XCTest gesture. Nothing is downloaded and nothing is installed.
 */

export type BridgeStatus =
  | { state: "unavailable"; detail: string }
  | { state: "idle" }
  | { state: "building"; since: number }
  | { state: "starting"; since: number }
  | { state: "ready"; port: number; width: number; height: number }
  | { state: "failed"; detail: string };

export interface BridgeCommand {
  type: "status" | "tap" | "press" | "swipe" | "text" | "key" | "home" | "orientation" | "stop";
  value?: string;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  duration?: number;
  text?: string;
  key?: "return" | "delete";
  candidates?: string[];
}

export interface BridgeOptions {
  /** The checked-in Xcode project. */
  projectDir: string;
  /** Where built products and logs live: one folder per Xcode build. */
  cacheDir: string;
  log?: (line: string) => void;
}

interface Session {
  child: ChildProcess;
  port: number;
  token: string;
  ready: Promise<{ width: number; height: number }>;
  size?: { width: number; height: number };
  startedAt: number;
  failure?: string;
}

const SCHEME = "CapsuleSimulatorBridge";
const TEST = "CapsuleSimulatorBridgeTests/BridgeTests/testServe";
const TOKEN_HEADER = "x-capsule-bridge-token";
/** The first launch installs the runner app too; later ones take a few seconds. */
const READY_TIMEOUT_MS = 240_000;
const BUILD_TIMEOUT_MS = 15 * 60_000;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") reject(new Error("No free port."));
        else resolve(address.port);
      });
    });
  });
}

function post(port: number, token: string, command: BridgeCommand, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(command);
    const request = http.request(
      { host: "127.0.0.1", port, path: "/command", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), [TOKEN_HEADER]: token }, timeout: timeoutMs },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; } catch { /* Not JSON. */ }
          if (response.statusCode === 200 && parsed.ok === true) resolve(parsed);
          else reject(new Error(typeof parsed.error === "string" ? parsed.error : `The touch bridge answered ${response.statusCode ?? "nothing"}.`));
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("The touch bridge did not answer in time.")));
    request.on("error", reject);
    request.end(body);
  });
}

export class SimulatorBridge {
  private build?: Promise<string>;
  private buildSince?: number;
  private buildFailure?: string;
  private readonly sessions = new Map<string, Session>();
  private support?: Promise<{ available: boolean; detail?: string }>;

  constructor(private readonly options: BridgeOptions) {}

  private log(line: string): void {
    this.options.log?.(`[simulator-bridge] ${line}`);
  }

  /** Whether this machine can build and run the bridge. Nothing is started to find out. */
  available(): Promise<{ available: boolean; detail?: string }> {
    this.support ??= (async () => {
      if (process.platform !== "darwin") return { available: false, detail: "The touch bridge needs macOS with Xcode." };
      if (!existsSync(path.join(this.options.projectDir, `${SCHEME}.xcodeproj`))) return { available: false, detail: "The touch bridge project is missing from this build of Capsule." };
      try {
        await run("xcodebuild", ["-version"], 20_000);
        return { available: true };
      } catch {
        return { available: false, detail: "Touch input needs the full Xcode app (not only the command-line tools) selected with xcode-select." };
      }
    })();
    return this.support;
  }

  status(udid: string): BridgeStatus {
    const session = this.sessions.get(udid);
    if (session?.size) return { state: "ready", port: session.port, width: session.size.width, height: session.size.height };
    if (session?.failure) return { state: "failed", detail: session.failure };
    if (session) return { state: "starting", since: session.startedAt };
    if (this.buildFailure) return { state: "failed", detail: this.buildFailure };
    if (this.build && this.buildSince) return { state: "building", since: this.buildSince };
    return { state: "idle" };
  }

  /** Forget a failure so the next use tries again. */
  retry(udid?: string): void {
    this.buildFailure = undefined;
    if (udid) {
      const session = this.sessions.get(udid);
      if (session?.failure) { this.sessions.delete(udid); stopChild(session.child); }
    }
  }

  /** One folder per Xcode build and bridge source: editing the runner must not reuse a stale build. */
  private async productsDir(): Promise<string> {
    const { stdout } = await run("xcodebuild", ["-version"], 20_000);
    const build = /Build version (\S+)/.exec(stdout)?.[1] ?? "unknown";
    const source = await readFile(path.join(this.options.projectDir, "BridgeTests", "BridgeTests.swift")).catch(() => Buffer.alloc(0));
    return path.join(this.options.cacheDir, `${build}-${createHash("sha256").update(source).digest("hex").slice(0, 10)}`);
  }

  private async findTestRun(derived: string): Promise<string | undefined> {
    try {
      const products = path.join(derived, "Build", "Products");
      const entries = await readdir(products);
      const match = entries.find((name) => name.startsWith(`${SCHEME}_iphonesimulator`) && name.endsWith(".xctestrun"));
      return match ? path.join(products, match) : undefined;
    } catch {
      return undefined;
    }
  }

  /** Build once per Xcode version; a second caller waits on the same build. */
  ensureBuilt(): Promise<string> {
    if (this.build) return this.build;
    this.buildFailure = undefined;
    this.build = (async () => {
      const derived = await this.productsDir();
      const existing = await this.findTestRun(derived);
      if (existing) return existing;
      await mkdir(derived, { recursive: true });
      this.buildSince = Date.now();
      this.log("Building the touch bridge; the first use takes a minute or two.");
      const logFile = await open(path.join(derived, "build.log"), "w");
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("xcodebuild", [
            "build-for-testing", "-project", path.join(this.options.projectDir, `${SCHEME}.xcodeproj`), "-scheme", SCHEME,
            "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", derived, "CODE_SIGNING_ALLOWED=NO", "-quiet",
          ], { stdio: ["ignore", logFile.fd, logFile.fd] });
          const timer = setTimeout(() => { stopChild(child, "SIGKILL"); reject(new Error("Building the touch bridge took too long.")); }, BUILD_TIMEOUT_MS);
          child.on("error", (error) => { clearTimeout(timer); reject(error); });
          child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`xcodebuild exited with ${code}.`));
          });
        });
      } finally {
        await logFile.close();
      }
      const built = await this.findTestRun(derived);
      if (!built) throw new Error("The build finished but produced no test run.");
      this.log(`Built in ${Math.round((Date.now() - (this.buildSince ?? Date.now())) / 1000)}s.`);
      return built;
    })();
    this.build.catch(async (error: unknown) => {
      const tail = await this.logTail(path.join(await this.productsDir().catch(() => this.options.cacheDir), "build.log"));
      this.buildFailure = `${error instanceof Error ? error.message : String(error)}${tail ? ` ${tail}` : ""}`;
      this.build = undefined;
    }).finally(() => { this.buildSince = undefined; });
    return this.build;
  }

  private async logTail(file: string): Promise<string> {
    try {
      const text = await readFile(file, "utf8");
      const lines = text.trim().split("\n").filter((line) => /error|failed/i.test(line));
      return lines.slice(-3).join(" ").slice(0, 400);
    } catch {
      return "";
    }
  }

  /** Start the runner on this device if it is not already up, and wait until it answers. */
  async ensure(udid: string): Promise<{ width: number; height: number }> {
    const live = this.sessions.get(udid);
    if (live && !live.failure) return live.ready;
    if (live) this.sessions.delete(udid);
    const testRun = await this.ensureBuilt();
    const derived = path.dirname(path.dirname(path.dirname(testRun)));
    const port = await freePort();
    const token = randomBytes(32).toString("hex");
    const logFile = await open(path.join(derived, `runner-${udid}.log`), "w");
    const child = spawn("xcodebuild", [
      "test-without-building", "-xctestrun", testRun, "-destination", `id=${udid}`, "-only-testing", TEST,
      "-parallel-testing-enabled", "NO", "-test-timeouts-enabled", "NO", "-derivedDataPath", derived,
    ], { stdio: ["ignore", logFile.fd, logFile.fd], env: { ...process.env, TEST_RUNNER_CAPSULE_BRIDGE_PORT: String(port), TEST_RUNNER_CAPSULE_BRIDGE_TOKEN: token } });
    void logFile.close();
    const session: Session = { child, port, token, startedAt: Date.now(), ready: Promise.resolve({ width: 0, height: 0 }) };
    let exited = false;
    child.on("exit", (code) => {
      exited = true;
      if (this.sessions.get(udid) === session) {
        if (!session.size) session.failure = `The touch bridge stopped before it was ready (xcodebuild exited with ${code ?? "a signal"}).`;
        else this.sessions.delete(udid);
      }
    });
    child.on("error", () => { exited = true; });
    session.ready = (async () => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (exited) throw new Error(session.failure ?? "The touch bridge stopped before it was ready.");
        try {
          const status = await post(port, token, { type: "status" }, 3_000);
          if (typeof status.width === "number" && typeof status.height === "number") {
            session.size = { width: status.width, height: status.height };
            this.log(`Ready on ${udid} after ${Math.round((Date.now() - session.startedAt) / 1000)}s.`);
            return session.size;
          }
        } catch { /* Not up yet. */ }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
      stopChild(child);
      throw new Error("The touch bridge did not start in time.");
    })();
    session.ready.catch((error: Error) => { session.failure = error.message; });
    this.sessions.set(udid, session);
    return session.ready;
  }

  async command(udid: string, command: BridgeCommand): Promise<Record<string, unknown>> {
    const session = this.sessions.get(udid);
    if (!session?.size) throw new Error("Touch input is not connected to this simulator yet.");
    try {
      const result = await post(session.port, session.token, command, 30_000);
      if (command.type === "orientation" && typeof result.width === "number" && typeof result.height === "number") session.size = { width: result.width, height: result.height };
      return result;
    } catch (error) {
      // A runner that is gone is reported as such; the next use restarts it.
      if (session.child.exitCode !== null && this.sessions.get(udid) === session) this.sessions.delete(udid);
      throw error;
    }
  }

  stop(udid: string): void {
    const session = this.sessions.get(udid);
    if (!session) return;
    this.sessions.delete(udid);
    stopChild(session.child);
  }

  stopAll(): void {
    for (const udid of [...this.sessions.keys()]) this.stop(udid);
  }
}
