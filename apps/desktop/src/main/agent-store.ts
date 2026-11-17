import path from "node:path";
import {
  binaryOverride,
  createAgentStore,
  notifyHarnessesChanged,
  recheckMissingBinaries,
  setManagedBinDir,
  userBinaryPath,
  whichBinary,
} from "@capsule/harness";
import { IPC_CHANNELS, isHarnessId, type AgentInstallProgress, type HarnessId } from "@capsule/shared";
import { existsSync } from "node:fs";

/*
 * The agent store's main-process half: reads the ACP registry, installs into
 * `agentsDir`, writes shims into `<agentsDir>/bin`, and updates copies the
 * user installed with the tool that owns them. See
 * `packages/shared/src/agent-setup.ts` for the contract.
 */
export interface AgentStoreHost {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void;
  emitProgress: (progress: AgentInstallProgress) => void;
  /** `<userData>/agents`. */
  agentsDir: string;
  /** Calls `listener` whenever a Capsule window gains focus. */
  onWindowFocus: (listener: () => void) => void;
  /** Whether any Capsule window has focus now. */
  windowFocused: () => boolean;
}

/*
 * An agent installed in a terminal shows up without a Check again: looked for
 * on focus, and every so often while a window is in front (the terminal dock
 * installs without the window ever losing focus). File checks only.
 */
const RECHECK_THROTTLE_MS = 3_000;
const RECHECK_INTERVAL_MS = 20_000;

function harnessIdArg(value: unknown): HarnessId {
  if (typeof value === "string" && isHarnessId(value)) return value;
  throw new Error("Capsule doesn't know that agent.");
}

export function registerAgentStore(host: AgentStoreHost): void {
  setManagedBinDir(path.join(host.agentsDir, "bin"));
  const store = createAgentStore({
    agentsDir: host.agentsDir,
    emit: host.emitProgress,
    host: () => {
      const npmPath = whichBinary(["npm"]);
      const nodePath = whichBinary(["node"]);
      return {
        platform: process.platform,
        arch: process.arch,
        hasNode: Boolean(npmPath),
        ...(npmPath ? { npmPath } : {}),
        ...(nodePath ? { nodeDir: path.dirname(nodePath) } : {}),
      };
    },
    userPath: (command, harnessId) => binaryOverride(harnessId) ?? userBinaryPath([command]),
    tools: () => ({
      npm: whichBinary(["npm"]),
      pnpm: whichBinary(["pnpm"]),
      bun: whichBinary(["bun"]),
      brew: whichBinary(["brew"]),
      exists: existsSync,
    }),
    changed: notifyHarnessesChanged,
  });

  host.handle(IPC_CHANNELS.agentStoreList, (refresh) => store.list(refresh === true));
  host.handle(IPC_CHANNELS.agentStoreInstall, (harnessId) => store.install(harnessIdArg(harnessId)));
  host.handle(IPC_CHANNELS.agentStoreUninstall, (harnessId) => store.uninstall(harnessIdArg(harnessId)));
  host.handle(IPC_CHANNELS.agentStoreUpdateUserCopy, (harnessId) => store.updateUserCopy(harnessIdArg(harnessId)));

  let lastRecheck = 0;
  const recheck = () => {
    const now = Date.now();
    if (now - lastRecheck < RECHECK_THROTTLE_MS) return;
    lastRecheck = now;
    recheckMissingBinaries();
  };
  host.onWindowFocus(recheck);
  setInterval(() => {
    if (host.windowFocused()) recheck();
  }, RECHECK_INTERVAL_MS).unref();
}
