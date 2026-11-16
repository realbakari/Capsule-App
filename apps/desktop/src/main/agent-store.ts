import path from "node:path";
import { createAgentStore, notifyHarnessesChanged, setManagedBinDir, userBinaryPath, whichBinary } from "@capsule/harness";
import { IPC_CHANNELS, isHarnessId, type AgentInstallProgress, type HarnessId } from "@capsule/shared";

/*
 * The agent store's main-process half: reads the ACP registry, installs into
 * `agentsDir`, and writes shims into `<agentsDir>/bin`. See
 * `packages/shared/src/agent-setup.ts` for the contract.
 */
export interface AgentStoreHost {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => void;
  emitProgress: (progress: AgentInstallProgress) => void;
  /** `<userData>/agents`. */
  agentsDir: string;
}

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
    userPath: (command) => userBinaryPath([command]),
    changed: notifyHarnessesChanged,
  });

  host.handle(IPC_CHANNELS.agentStoreList, (refresh) => store.list(refresh === true));
  host.handle(IPC_CHANNELS.agentStoreInstall, (harnessId) => store.install(harnessIdArg(harnessId)));
  host.handle(IPC_CHANNELS.agentStoreUninstall, (harnessId) => store.uninstall(harnessIdArg(harnessId)));
}
