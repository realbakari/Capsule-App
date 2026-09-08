import { IPC_CHANNELS, scopeForChannel } from "@capsule/shared";

const channelNames = new Map<string, string>(Object.entries(IPC_CHANNELS).map(([name, wire]) => [wire, name]));
const updateChannels = new Set<string>([IPC_CHANNELS.installUpdate, IPC_CHANNELS.downloadUpdate, IPC_CHANNELS.checkForUpdates]);

/** One gate for window and remote writes, including already-running requests. */
export class UpdateAdmission {
  private writes = 0;
  private reserved = false;

  async run<T>(channel: string, operation: () => T | Promise<T>): Promise<T> {
    const readOnly = scopeForChannel(channelNames.get(channel) ?? channel) === "read";
    if (readOnly || updateChannels.has(channel)) return operation();
    if (this.reserved) throw new Error("Capsule is preparing to restart for an update. Wait before making changes.");
    this.writes++;
    try { return await operation(); }
    finally { this.writes--; }
  }

  reserve(): () => void {
    if (this.reserved) throw new Error("An update restart is already being prepared.");
    if (this.writes > 0) throw new Error("Finish active workspace operations before restarting to install.");
    this.reserved = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.reserved = false;
    };
  }
}
