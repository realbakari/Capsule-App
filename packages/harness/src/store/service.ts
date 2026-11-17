import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnCommand } from "@capsule/process";
import {
  ACP_REGISTRY_URL,
  AGENT_PACKAGE_SOURCES,
  sanitizeUntrusted,
  type AgentInstallProgress,
  type AgentStoreEntry,
  type AgentUserCopy,
  type HarnessId,
} from "@capsule/shared";
import { installAgent, readManifest, runProcess, StoreError, uninstallAgent, type InstallablePlan, type StoreIo } from "./install.js";
import { isSafeVersion, NO_REGISTRY, planAgentStore, storeEntry, type AgentPlan, type HostFacts } from "./plan.js";
import { copyOwner, latestSource, parseVersionOutput, userUpdatePlan, versionFromLayout, type CopyOwner, type UpdateTools } from "./user-copy.js";

const FETCH_TIMEOUT_MS = 15_000;
const CATALOG_TTL_MS = 60 * 60_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
/* A release lookup that answered is good for hours; one that failed is tried again sooner, and never blocks the list. */
const LATEST_TTL_MS = 6 * 60 * 60_000;
const LATEST_RETRY_MS = 15 * 60_000;
const LATEST_TIMEOUT_MS = 8_000;
const VERSION_TIMEOUT_MS = 5_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

/** How the store reads a copy the user installed. Injected so tests never run a real CLI. */
export interface UserCopyIo {
  realPath(file: string): Promise<string>;
  /** The `version` in a package's package.json. */
  packageVersion(packageDir: string): Promise<string | undefined>;
  /** What `<file> --version` prints. */
  versionOutput(file: string): Promise<string | undefined>;
}

export const nodeUserCopyIo: UserCopyIo = {
  realPath: (file) => realpath(file),
  async packageVersion(packageDir) {
    const parsed = await readFile(path.join(packageDir, "package.json"), "utf8").then(JSON.parse, () => undefined) as { version?: unknown } | undefined;
    return typeof parsed?.version === "string" ? parsed.version : undefined;
  },
  versionOutput: (file) => new Promise((resolve) => {
    let out = "";
    const child = spawnCommand(file, ["--version"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => child.kill(), VERSION_TIMEOUT_MS);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { out = (out + chunk).slice(0, 4096); });
    child.on("error", () => { clearTimeout(timer); resolve(undefined); });
    child.on("close", (code) => { clearTimeout(timer); resolve(code === 0 ? out : undefined); });
  }),
};

interface Catalog {
  registry: unknown;
  registryError?: string;
  npmLatest: Record<string, string | undefined>;
}

export interface AgentStoreOptions {
  agentsDir: string;
  emit: (progress: AgentInstallProgress) => void;
  /** Tools on this computer, asked each time the list is built. */
  host: () => HostFacts & { npmPath?: string; nodeDir?: string };
  /** The user's own copy of a command (or the binary path set for this agent), ignoring the store's shims. */
  userPath: (command: string, harnessId: HarnessId) => string | undefined;
  /** Package managers on this computer, for updating a copy the user installed. */
  tools?: () => UpdateTools;
  copyIo?: UserCopyIo;
  /** Called after an install or removal so readiness redraws. */
  changed: () => void;
  fetch?: typeof fetch;
  run?: StoreIo["run"];
  platform?: NodeJS.Platform;
  now?: () => number;
}

export interface AgentStore {
  list(refresh?: boolean): Promise<AgentStoreEntry[]>;
  install(harnessId: HarnessId): Promise<AgentStoreEntry>;
  uninstall(harnessId: HarnessId): Promise<AgentStoreEntry>;
  /** Update the copy the user installed, with the tool that owns it. */
  updateUserCopy(harnessId: HarnessId): Promise<AgentStoreEntry>;
}

type UserCopyPlan = AgentUserCopy & { argv?: string[] };

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_JSON_BYTES) throw new Error("response too large");
  return JSON.parse(text);
}

function message(error: unknown, name: string): string {
  if (error instanceof StoreError) return error.message;
  const detail = error instanceof Error ? sanitizeUntrusted(error.message, { singleLine: true, maxChars: 200 }) : "";
  return `Capsule couldn't install ${name}.${detail ? ` ${detail}` : ""}`;
}

export function createAgentStore(options: AgentStoreOptions): AgentStore {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const io: StoreIo = {
    agentsDir: options.agentsDir,
    platform: options.platform ?? process.platform,
    fetch: fetchImpl,
    run: options.run ?? runProcess,
  };
  const registryCache = path.join(options.agentsDir, "registry.json");
  let fresh: { at: number; catalog: Catalog } | undefined;
  let loading: Promise<Catalog> | undefined;
  const busy = new Set<HarnessId>();
  const copyIo = options.copyIo ?? nodeUserCopyIo;
  const tools = options.tools ?? (() => ({ exists: () => false }));
  /* Ownership and version per real path: neither changes until something updates it. */
  const copies = new Map<string, Promise<{ owner: CopyOwner; version?: string }>>();
  const latest = new Map<string, { at: number; version?: string; pending?: Promise<string | undefined> }>();

  async function lookupLatest(source: NonNullable<ReturnType<typeof latestSource>>): Promise<string | undefined> {
    const json = (url: string) => fetchImpl(url, { signal: AbortSignal.timeout(LATEST_TIMEOUT_MS) })
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((text) => (text.length > MAX_JSON_BYTES ? undefined : JSON.parse(text)) as Record<string, unknown> | undefined);
    let found: unknown;
    if ("npm" in source) {
      found = (await json(`https://registry.npmjs.org/-/package/${source.npm.replace("/", "%2f")}/dist-tags`))?.latest;
    } else {
      const body = await json(`https://formulae.brew.sh/api/${source.cask ? "cask" : "formula"}/${encodeURIComponent(source.homebrew)}.json`);
      found = source.cask
        ? String(body?.version ?? "").split(",")[0]
        : (body?.versions as { stable?: unknown } | undefined)?.stable;
    }
    return isSafeVersion(found) ? found : undefined;
  }

  async function latestFor(source: NonNullable<ReturnType<typeof latestSource>>): Promise<string | undefined> {
    const key = "npm" in source ? `npm:${source.npm}` : `brew:${source.cask ? "cask" : "formula"}:${source.homebrew}`;
    const cached = latest.get(key);
    if (cached?.pending) return cached.pending;
    if (cached && now() - cached.at < (cached.version ? LATEST_TTL_MS : LATEST_RETRY_MS)) return cached.version;
    const pending = lookupLatest(source).catch(() => undefined);
    latest.set(key, { at: now(), ...(cached?.version ? { version: cached.version } : {}), pending });
    const version = await pending;
    /* Offline keeps the last answer instead of forgetting that an update exists. */
    latest.set(key, { at: now(), ...((version ?? cached?.version) ? { version: version ?? cached?.version } : {}) });
    return version ?? cached?.version;
  }

  async function userCopy(plan: AgentPlan): Promise<UserCopyPlan | undefined> {
    const commandPath = options.userPath(plan.command, plan.harnessId);
    if (!commandPath) return undefined;
    const real = await copyIo.realPath(commandPath).catch(() => commandPath);
    let known = copies.get(real);
    if (!known) {
      known = (async () => {
        const owner = copyOwner({ harnessId: plan.harnessId, realPath: real });
        const fromPackage = "packageDir" in owner ? await copyIo.packageVersion(owner.packageDir).catch(() => undefined) : undefined;
        const version = versionFromLayout(owner) ?? fromPackage ?? parseVersionOutput((await copyIo.versionOutput(commandPath).catch(() => undefined)) ?? "");
        return { owner, ...(version ? { version } : {}) };
      })();
      copies.set(real, known);
    }
    const { owner, version } = await known;
    const source = latestSource(owner);
    const newest = source ? await latestFor(source) : undefined;
    const update = userUpdatePlan({ owner, commandPath, version, latest: newest, tools: tools(), platform: io.platform });
    return {
      path: commandPath,
      ...(version ? { version } : {}),
      ...(newest ? { latest: newest } : {}),
      ...(update ? { update: { via: update.via, command: update.command, oneClick: update.oneClick } } : {}),
      ...(update?.argv ? { argv: update.argv } : {}),
    };
  }

  async function loadCatalog(): Promise<Catalog> {
    const npmNames = [...new Set(Object.values(AGENT_PACKAGE_SOURCES).flatMap((source) => (source?.kind === "npm" ? [source.packageName] : [])))];
    const npmLatest: Record<string, string | undefined> = {};
    const npm = Promise.all(
      npmNames.map(async (name) => {
        const tags = (await fetchJson(fetchImpl, `https://registry.npmjs.org/-/package/${name.replace("/", "%2f")}/dist-tags`).catch(() => undefined)) as
          | { latest?: unknown }
          | undefined;
        npmLatest[name] = typeof tags?.latest === "string" ? tags.latest : undefined;
      }),
    );
    let registry: unknown;
    let online = true;
    try {
      registry = await fetchJson(fetchImpl, ACP_REGISTRY_URL);
      await mkdir(options.agentsDir, { recursive: true });
      const temp = `${registryCache}.tmp`;
      await writeFile(temp, JSON.stringify(registry));
      await rename(temp, registryCache);
    } catch {
      online = false;
      registry = await readFile(registryCache, "utf8").then(JSON.parse, () => undefined);
    }
    await npm;
    for (const [name, version] of Object.entries(npmLatest)) if (version) latest.set(`npm:${name}`, { at: now(), version });
    const catalog: Catalog = { registry, ...(registry === undefined ? { registryError: NO_REGISTRY } : {}), npmLatest };
    // Only a catalog read from the network is kept, so coming back online shows up on the next list.
    if (online && Object.values(npmLatest).every(Boolean)) fresh = { at: now(), catalog };
    return catalog;
  }

  async function catalog(refresh: boolean): Promise<Catalog> {
    if (!refresh && fresh && now() - fresh.at < CATALOG_TTL_MS) return fresh.catalog;
    loading ??= loadCatalog().finally(() => {
      loading = undefined;
    });
    return loading;
  }

  async function plans(refresh = false): Promise<AgentPlan[]> {
    const facts = options.host();
    return planAgentStore({ ...(await catalog(refresh)), host: facts });
  }

  async function entryFor(plan: AgentPlan): Promise<AgentStoreEntry> {
    const manifest = await readManifest(options.agentsDir, plan.storeKey);
    const installed = manifest && { version: manifest.version, kind: manifest.kind, installedAt: manifest.installedAt };
    const copy = await userCopy(plan);
    const { argv: _argv, ...user } = copy ?? {};
    return storeEntry(plan, installed, copy ? (user as AgentUserCopy) : undefined);
  }

  async function planFor(harnessId: HarnessId): Promise<AgentPlan> {
    const plan = (await plans()).find((item) => item.harnessId === harnessId);
    if (!plan) throw new StoreError("Capsule can't install that agent.");
    return plan;
  }

  function claim(plan: AgentPlan): () => void {
    if (busy.has(plan.storeKey)) throw new StoreError(`${plan.name} is already being installed or removed.`);
    busy.add(plan.storeKey);
    return () => busy.delete(plan.storeKey);
  }

  return {
    async list(refresh = false) {
      if (refresh) {
        copies.clear();
        latest.clear();
      }
      return Promise.all((await plans(refresh)).map(entryFor));
    },

    async updateUserCopy(harnessId) {
      const plan = await planFor(harnessId);
      const release = claim(plan);
      try {
        copies.clear();
        const copy = await userCopy(plan);
        if (!copy?.update) throw new StoreError(`${plan.name} is already up to date.`);
        if (!copy.argv) throw new StoreError(`Capsule can't run that update itself. Run \`${copy.update.command}\` in a terminal.`);
        options.emit({ harnessId, phase: "updating", detail: copy.update.command });
        const [file, ...args] = copy.argv;
        /* npm and its kin start with `#!/usr/bin/env node`; the node beside them is the one they belong to. */
        const env = { ...process.env, PATH: [path.dirname(file!), process.env.PATH].filter(Boolean).join(path.delimiter) };
        const result = await io.run(file!, args, { env, timeoutMs: UPDATE_TIMEOUT_MS });
        if (result.code !== 0) {
          const line = result.stderr.split(/\r?\n/).map((part) => part.trim()).filter(Boolean).pop() ?? "";
          throw new StoreError(`${plan.name} didn't update.${line ? ` ${sanitizeUntrusted(line, { singleLine: true, maxChars: 200 })}` : ""}`);
        }
        copies.clear();
        const after = await userCopy(plan);
        options.emit({ harnessId, phase: "done", version: after?.version ?? copy.latest ?? "" });
      } catch (error) {
        const text = error instanceof StoreError ? error.message : `${plan.name} didn't update.`;
        options.emit({ harnessId, phase: "failed", error: text });
        throw new StoreError(text);
      } finally {
        release();
        options.changed();
      }
      return entryFor(plan);
    },

    async install(harnessId) {
      const plan = await planFor(harnessId);
      const release = claim(plan);
      try {
        if (!plan.recipe) throw new StoreError(plan.unavailable);
        const facts = options.host();
        const manifest = await installAgent({
          ...io,
          plan: plan as InstallablePlan,
          report: options.emit,
          ...(facts.npmPath ? { npmPath: facts.npmPath } : {}),
          ...(facts.nodeDir ? { nodeDir: facts.nodeDir } : {}),
        });
        options.emit({ harnessId, phase: "done", version: manifest.version });
      } catch (error) {
        const text = message(error, plan.name);
        options.emit({ harnessId, phase: "failed", error: text });
        throw new StoreError(text);
      } finally {
        release();
        options.changed();
      }
      return entryFor(plan);
    },

    async uninstall(harnessId) {
      const plan = await planFor(harnessId);
      const release = claim(plan);
      try {
        await uninstallAgent(options.agentsDir, plan, io.platform);
      } catch (error) {
        throw new StoreError(`Capsule couldn't remove ${plan.name}. ${error instanceof Error ? sanitizeUntrusted(error.message, { singleLine: true, maxChars: 200 }) : ""}`.trim());
      } finally {
        release();
        options.changed();
      }
      return entryFor(plan);
    },
  };
}
