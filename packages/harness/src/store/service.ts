import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ACP_REGISTRY_URL,
  AGENT_PACKAGE_SOURCES,
  sanitizeUntrusted,
  type AgentInstallProgress,
  type AgentStoreEntry,
  type HarnessId,
} from "@capsule/shared";
import { installAgent, readManifest, runProcess, StoreError, uninstallAgent, type InstallablePlan, type StoreIo } from "./install.js";
import { NO_REGISTRY, planAgentStore, storeEntry, type AgentPlan, type HostFacts } from "./plan.js";

const FETCH_TIMEOUT_MS = 15_000;
const CATALOG_TTL_MS = 60 * 60_000;
const MAX_JSON_BYTES = 5 * 1024 * 1024;

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
  /** The user's own copy of a command, ignoring the store's shims. */
  userPath: (command: string) => string | undefined;
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
}

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
    return storeEntry(plan, installed, options.userPath(plan.command));
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
      return Promise.all((await plans(refresh)).map(entryFor));
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
