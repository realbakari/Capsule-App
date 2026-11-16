import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { spawnCommand } from "@capsule/process";
import { sanitizeUntrusted, type AgentInstallPhase, type AgentInstallProgress, type AgentManagedInstall } from "@capsule/shared";
import { isSafeVersion, type AgentPlan, type InstallRecipe } from "./plan.js";
import { renderShim, shimFileName } from "./shim.js";

/** A failure whose message is already a sentence the user can read. */
export class StoreError extends Error {}

/** What `<agentsDir>/<storeKey>/manifest.json` records about a Capsule-managed copy. */
export interface StoreManifest extends AgentManagedInstall {
  kind: "binary" | "npm";
  /** The program the shim runs. */
  target: string;
}

export type InstallablePlan = AgentPlan & { recipe: InstallRecipe };

export type Runner = (
  file: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<{ code: number | null; stderr: string }>;

export interface StoreIo {
  agentsDir: string;
  platform: NodeJS.Platform;
  fetch: typeof fetch;
  run: Runner;
}

export interface InstallRequest extends StoreIo {
  plan: InstallablePlan;
  report: (progress: AgentInstallProgress) => void;
  /** npm, for npm recipes. */
  npmPath?: string;
  /** The folder holding the `node` that npm used, searched by the shim after PATH. */
  nodeDir?: string;
}

const STALL_MS = 60_000;
const NPM_TIMEOUT_MS = 10 * 60_000;
const UNPACK_TIMEOUT_MS = 5 * 60_000;

export function storePaths(agentsDir: string, storeKey: string) {
  const home = path.join(agentsDir, storeKey);
  return {
    home,
    manifest: path.join(home, "manifest.json"),
    staging: path.join(agentsDir, ".staging", storeKey),
    bin: path.join(agentsDir, "bin"),
  };
}

export const runProcess: Runner = (file, args, { env, timeoutMs }) =>
  new Promise((resolve) => {
    const child = spawnCommand(file, args, { env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

function lastLine(text: string): string {
  const line = text.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).pop() ?? "";
  return sanitizeUntrusted(line, { singleLine: true, maxChars: 200 });
}

async function writeAtomic(file: string, content: string, mode: number): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { mode });
  await chmod(temp, mode);
  await rename(temp, file);
}

async function download(
  url: string,
  file: string,
  fetchImpl: typeof fetch,
  onBytes: (received: number, total: number | undefined) => void,
): Promise<string> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), STALL_MS);
  };
  arm();
  try {
    const response = await fetchImpl(url, { signal: controller.signal, redirect: "follow" });
    if (response.url && !response.url.startsWith("https:")) {
      throw new StoreError("The download was redirected away from HTTPS, so Capsule stopped it.");
    }
    if (!response.ok || !response.body) throw new StoreError(`The download failed (HTTP ${response.status}).`);
    const total = Number(response.headers.get("content-length")) || undefined;
    const hash = createHash("sha256");
    let received = 0;
    await pipeline(
      Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
      async function* (source: AsyncIterable<Buffer>) {
        for await (const chunk of source) {
          arm();
          hash.update(chunk);
          received += chunk.length;
          onBytes(received, total);
          yield chunk;
        }
      },
      createWriteStream(file),
    );
    return hash.digest("hex");
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (controller.signal.aborted) throw new StoreError("The download stalled. Check your connection, then try again.");
    throw new StoreError("The download didn't finish. Check your connection, then try again.");
  } finally {
    clearTimeout(timer);
  }
}

interface InstallState {
  request: InstallRequest;
  staging: string;
  payload: string;
  downloadFile: string;
  digest?: string;
}

/*
 * Each install walks one row of this table, emitting each phase as it enters
 * it. A failure anywhere leaves the live copy untouched: everything up to
 * `linking` happens in the staging folder.
 */
const PIPELINE: Record<InstallRecipe["kind"], AgentInstallPhase[]> = {
  binary: ["resolving", "downloading", "verifying", "extracting", "linking"],
  npm: ["resolving", "installing", "linking"],
};

const STEPS: Record<AgentInstallPhase, (state: InstallState) => Promise<void>> = {
  async resolving(state) {
    await rm(state.staging, { recursive: true, force: true });
    await mkdir(state.payload, { recursive: true });
  },

  async downloading(state) {
    const { plan, report } = state.request;
    const recipe = plan.recipe as Extract<InstallRecipe, { kind: "binary" }>;
    let lastReport = 0;
    state.digest = await download(recipe.url, state.downloadFile, state.request.fetch, (received, total) => {
      const now = Date.now();
      if (now - lastReport < 150 && received !== total) return;
      lastReport = now;
      report({ harnessId: plan.harnessId, phase: "downloading", received, ...(total ? { total } : {}) });
    });
  },

  async verifying(state) {
    const { plan } = state.request;
    const recipe = plan.recipe as Extract<InstallRecipe, { kind: "binary" }>;
    if (recipe.sha256 && recipe.sha256 !== state.digest) {
      await rm(state.downloadFile, { force: true });
      throw new StoreError(`The ${plan.name} download didn't match its published checksum, so Capsule didn't install it.`);
    }
  },

  async extracting(state) {
    const { plan, platform, run } = state.request;
    const recipe = plan.recipe as Extract<InstallRecipe, { kind: "binary" }>;
    if (recipe.archive === "raw") {
      const target = path.join(state.payload, ...recipe.entry);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(state.downloadFile, target);
      return;
    }
    const [file, args] =
      recipe.archive === "zip" && platform !== "win32"
        ? ["unzip", ["-q", state.downloadFile, "-d", state.payload]]
        : ["tar", ["-xf", state.downloadFile, "-C", state.payload]];
    const result = await run(file, args, { timeoutMs: UNPACK_TIMEOUT_MS });
    await rm(state.downloadFile, { force: true });
    if (result.code !== 0) throw new StoreError(`Capsule couldn't unpack the ${plan.name} download. ${lastLine(result.stderr)}`.trim());
  },

  async installing(state) {
    const { plan, run, npmPath, nodeDir } = state.request;
    const recipe = plan.recipe as Extract<InstallRecipe, { kind: "npm" }>;
    if (!npmPath) throw new StoreError(`${plan.name} needs Node.js. Install it from nodejs.org, then try again.`);
    // npm's launcher is `#!/usr/bin/env node`; an app started from the Dock may not have node on PATH.
    const searchPath = [path.dirname(npmPath), nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter);
    const result = await run(
      npmPath,
      ["install", "--prefix", state.payload, "--no-audit", "--no-fund", "--loglevel=error", `${recipe.packageName}@${recipe.version}`],
      { env: { ...process.env, PATH: searchPath }, timeoutMs: NPM_TIMEOUT_MS },
    );
    if (result.code !== 0) throw new StoreError(`npm couldn't install ${plan.name}. ${lastLine(result.stderr)}`.trim());
  },

  async linking(state) {
    const { plan, agentsDir, platform, nodeDir } = state.request;
    const { recipe } = plan;
    const relative = recipe.kind === "binary" ? recipe.entry : ["node_modules", ".bin", shimFileName(plan.command, platform)];
    if (!existsSync(path.join(state.payload, ...relative))) {
      throw new StoreError(
        recipe.kind === "npm"
          ? `The ${recipe.packageName} package doesn't provide a \`${plan.command}\` command, so Capsule can't launch it.`
          : `The ${plan.name} download doesn't contain \`${relative.join("/")}\`.`,
      );
    }
    const paths = storePaths(agentsDir, plan.storeKey);
    const versionDir = path.join(paths.home, recipe.version);
    await mkdir(paths.home, { recursive: true });
    await rm(versionDir, { recursive: true, force: true });
    await rename(state.payload, versionDir);
    const target = path.join(versionDir, ...relative);
    if (platform !== "win32") await chmod(target, 0o755);

    await mkdir(paths.bin, { recursive: true });
    const shim = renderShim({ target, env: recipe.env, ...(recipe.kind === "npm" && nodeDir ? { pathAfter: nodeDir } : {}) }, platform);
    await writeAtomic(path.join(paths.bin, shimFileName(plan.command, platform)), shim, 0o755);

    const manifest: StoreManifest = { version: recipe.version, kind: recipe.kind, installedAt: new Date().toISOString(), target };
    await writeAtomic(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`, 0o644);

    for (const name of await readdir(paths.home)) {
      if (name !== recipe.version && name !== "manifest.json") await rm(path.join(paths.home, name), { recursive: true, force: true });
    }
    await rm(state.staging, { recursive: true, force: true });
  },
};

/**
 * Install or update one agent: stage it, then switch the shim and manifest to
 * it and drop older versions. Running it again converges on the same result.
 */
export async function installAgent(request: InstallRequest): Promise<StoreManifest> {
  const { plan, report } = request;
  const staging = storePaths(request.agentsDir, plan.storeKey).staging;
  const state: InstallState = {
    request,
    staging,
    payload: path.join(staging, "payload"),
    downloadFile: path.join(staging, "download"),
  };
  try {
    for (const phase of PIPELINE[plan.recipe.kind]) {
      report({ harnessId: plan.harnessId, phase });
      await STEPS[phase](state);
    }
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  const manifest = await readManifest(request.agentsDir, plan.storeKey);
  if (!manifest) throw new StoreError(`${plan.name} installed, but Capsule couldn't read back its record.`);
  return manifest;
}

/** The managed copy, or undefined when there is none or its record no longer matches the disk. */
export async function readManifest(agentsDir: string, storeKey: string): Promise<StoreManifest | undefined> {
  const paths = storePaths(agentsDir, storeKey);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(paths.manifest, "utf8"));
  } catch {
    return undefined;
  }
  const value = raw as Partial<StoreManifest> | null;
  if (
    !value ||
    !isSafeVersion(value.version) ||
    (value.kind !== "binary" && value.kind !== "npm") ||
    typeof value.installedAt !== "string" ||
    typeof value.target !== "string" ||
    !value.target.startsWith(path.join(paths.home, value.version) + path.sep)
  ) {
    return undefined;
  }
  const exists = await stat(value.target).then(() => true, () => false);
  return exists ? { version: value.version, kind: value.kind, installedAt: value.installedAt, target: value.target } : undefined;
}

/** Remove the shim and the agent's own folder. Nothing outside them is touched. */
export async function uninstallAgent(agentsDir: string, plan: AgentPlan, platform: NodeJS.Platform): Promise<void> {
  const paths = storePaths(agentsDir, plan.storeKey);
  await rm(path.join(paths.bin, shimFileName(plan.command, platform)), { force: true });
  await rm(paths.home, { recursive: true, force: true });
  await rm(paths.staging, { recursive: true, force: true });
}
