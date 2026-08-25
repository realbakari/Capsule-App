import type { ChannelBinding, ConnectionState } from "@capsule/shared";

export interface BuzzAdapter {
  listBindings(): Promise<ChannelBinding[]>;
  getStatus(): Promise<ConnectionState>;
}

export function createBuzzAdapter(listChannels: () => Promise<ChannelBinding[]>): BuzzAdapter {
  return {
    async listBindings() {
      const channels = await listChannels();
      return channels.filter((channel) => channel.channel === "buzz");
    },
    async getStatus() {
      const bindings = await this.listBindings();
      if (bindings.length === 0) return "disconnected";
      return bindings.some((binding) => binding.status === "connected")
        ? "connected"
        : "disconnected";
    },
  };
}
