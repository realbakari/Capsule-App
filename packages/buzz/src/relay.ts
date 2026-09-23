import type { ChannelInvitation, ChannelMember, ChannelMessage, ChannelPost, NewSharedChannel, RelayConnectionInput, RelayConnectionStatus, SharedChannel, SharedChannelDetails, ChannelUpdate, ChannelManagementAction, ChannelReaction } from "@capsule/shared";
import { runRelayCommand, type RelayCommand, type RelayCredentials } from "./cli.js";
import { RelayAvatars } from "./avatars.js";
import { createHash } from "node:crypto";
import { RequestSlots } from "./request-slots.js";
import { setMaxListeners } from "node:events";

export interface RelayCredentialStore {
  available(): boolean;
  read(): RelayCredentials | undefined;
  write(credentials: RelayCredentials): void;
  clear(): void;
}

const HEX = /^[a-f0-9]{64}$/i;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const keyDigest = (key: string) => createHash("sha256").update(key).digest("hex");
const connectionController = () => {
  const controller = new AbortController();
  // Four children, up to 64 waiters and bounded avatar downloads share this signal.
  setMaxListeners(96, controller.signal);
  return controller;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Unsupported relay response.");
  return value as Record<string, unknown>;
};
const rows = (value: unknown, limit: number): unknown[] => {
  if (!Array.isArray(value) || value.length > limit) throw new Error("Unsupported or oversized relay response.");
  return value;
};
function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || value.includes("\0")) throw new Error(`Invalid ${label}.`);
  return value;
}
function identifier(value: unknown, type: "channel" | "identity" | "message"): string {
  if (typeof value !== "string" || !(type === "channel" ? UUID : HEX).test(value)) throw new Error(`Invalid ${type} ID.`);
  return value.toLowerCase();
}
export function relayUrl(value: unknown): string {
  const raw = text(value, 2048, "relay URL").trim().replace(/^ws:/, "http:").replace(/^wss:/, "https:");
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid relay URL."); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (!(["https:"].includes(url.protocol) || (url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Use an HTTPS relay origin, or HTTP on localhost. Do not include credentials, a path, or a query.");
  }
  return url.origin;
}
function accepted(value: unknown): Record<string, unknown> {
  const result = record(value);
  // Exit zero does not mean the relay accepted the signed event.
  if (result.accepted !== true) throw new Error("The relay did not accept this change. Check channel membership and permissions before retrying.");
  return result;
}

/** An explicitly connected identity. Disconnect cancels reads and writes.
 * Incoming messages are never interpreted as local commands or auto-dispatched. */
export class SharedRelayClient {
  private connection?: RelayCredentials;
  private controller = connectionController();
  private connected = false;
  private slots = new RequestSlots();
  private reads = new Map<string, Promise<unknown>>();
  private restored?: Promise<void>;
  private saved?: { url: string; digest: string };
  private hasSaved = false;
  private warning?: string;
  private generation = 0;
  private pictures = new Map<string, string>();
  private avatars = new RelayAvatars();
  private identity?: Promise<string | undefined>;
  constructor(private readonly execute: RelayCommand = runRelayCommand, private readonly storage?: RelayCredentialStore) {}

  status(): RelayConnectionStatus {
    return { connected: this.connected, url: this.connection?.url ?? this.saved?.url,
      remembered: !!this.saved && (!this.connection || (this.saved.url === this.connection.url && this.saved.digest === keyDigest(this.connection.privateKey))),
      hasSaved: this.hasSaved, canRemember: this.storage?.available() ?? false, warning: this.warning };
  }
  /** Restore once when Channels is opened, not during app startup. A manual
   * disconnect stays disconnected for the remainder of this process. */
  async restore(): Promise<RelayConnectionStatus> {
    await (this.restored ??= this.generation === 0 ? this.restoreOnce() : Promise.resolve());
    return this.status();
  }
  private async restoreOnce(): Promise<void> {
    let generation = this.generation;
    try {
      const saved = this.storage?.read();
      if (!saved) return;
      this.saved = { url: relayUrl(saved.url), digest: keyDigest(saved.privateKey) }; this.hasSaved = true;
      const connecting = this.connect(saved);
      generation = this.generation;
      await connecting;
    } catch {
      if (this.generation === generation) {
        this.hasSaved = true;
        this.warning = "Could not reconnect with the saved identity. Check the relay or enter the key again. Your saved connection has not been removed.";
      }
    }
  }
  remember(): RelayConnectionStatus {
    if (!this.connected || !this.connection) throw new Error("Connect to the relay before remembering its identity.");
    if (!this.storage?.available()) throw new Error("Protected credential storage is unavailable. This connection can only be used for this app session.");
    try { this.storage.write(this.connection); }
    catch { throw new Error("Could not save the relay identity securely. The current connection is still available."); }
    this.saved = { url: this.connection.url, digest: keyDigest(this.connection.privateKey) }; this.hasSaved = true; this.warning = undefined;
    return this.status();
  }
  forget(): RelayConnectionStatus {
    // Remove the persistent copy first; do not claim success if deletion fails.
    try { this.storage?.clear(); } catch { throw new Error("Could not remove the saved relay connection. Try again."); }
    this.disconnect(); this.saved = undefined; this.hasSaved = false;
    return this.status();
  }
  disconnect(): void {
    this.generation++;
    this.warning = undefined;
    this.clearConnection();
  }
  private clearConnection(): void {
    this.pictures.clear(); this.avatars.clear();
    this.identity = undefined;
    this.reads.clear();
    this.controller.abort();
    this.controller = connectionController();
    this.connection = undefined;
    this.connected = false;
  }
  async connect(input: RelayConnectionInput): Promise<RelayConnectionStatus> {
    const data = record(input);
    const url = relayUrl(data.url);
    if (data.remember !== undefined && typeof data.remember !== "boolean") throw new Error("Invalid remember preference.");
    let privateKey = text(data.privateKey, 100, "private key", true).trim();
    if (!privateKey) {
      let saved: RelayCredentials | undefined;
      try { saved = this.storage?.read(); } catch { throw new Error("The saved identity cannot be opened. Enter the key again, or forget this connection."); }
      if (!saved || relayUrl(saved.url) !== url) throw new Error("Enter the identity key for this relay.");
      this.saved = { url, digest: keyDigest(saved.privateKey) }; this.hasSaved = true;
      privateKey = saved.privateKey;
    }
    if (!HEX.test(privateKey) && !/^nsec1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(privateKey)) throw new Error("Enter a hex or nsec identity key.");
    this.disconnect();
    const connection = { url, privateKey };
    this.connection = connection;
    this.warning = undefined;
    try {
      rows(await this.command(["channels", "list", "--limit", "100"]), 100);
      if (this.connection !== connection) throw new Error("The channel connection changed.");
      this.connected = true;
      if (data.remember === true) {
        try { this.remember(); }
        catch { this.warning = "Connected for this app session, but the identity could not be saved securely. Use Connection options to try saving again."; }
      }
      return this.status();
    } catch (error) {
      if (this.connection === connection) this.clearConnection();
      throw error;
    }
  }
  private command(args: string[], input?: string): Promise<unknown> {
    const read = ["channels:list", "channels:search", "channels:members", "users:get", "messages:get", "messages:thread", "reactions:get"].includes(`${args[0]}:${args[1]}`);
    if (!read) return this.executeCommand(args, input);
    const key = JSON.stringify(args);
    const existing = this.reads.get(key);
    if (existing) return existing;
    const request = this.executeCommand(args, input).finally(() => { if (this.reads.get(key) === request) this.reads.delete(key); });
    this.reads.set(key, request);
    return request;
  }
  private async executeCommand(args: string[], input?: string): Promise<unknown> {
    const connection = this.connection;
    const signal = this.controller.signal;
    if (!connection) throw new Error("Connect a relay identity first.");
    const release = await this.slots.acquire(signal);
    try {
      if (signal.aborted || this.connection !== connection) throw new Error("The channel connection changed.");
      const response = await this.execute(connection, args, signal, input);
      if (signal.aborted || this.connection !== connection) throw new Error("The channel connection changed.");
      return response;
    } finally { release(); }
  }
  async channels(): Promise<SharedChannel[]> {
    const [all, mine] = await Promise.all([
      this.command(["channels", "list", "--limit", "100"]),
      this.command(["channels", "list", "--member", "--limit", "100"]),
    ]);
    const joined = new Set(rows(mine, 100).map((item) => identifier(record(item).channel_id, "channel")));
    return rows(all, 100).map((item) => {
      const row = record(item);
      const id = identifier(row.channel_id, "channel");
      return { id, name: text(row.name, 500, "channel name"), description: text(row.description ?? "", 4000, "channel description", true), joined: joined.has(id) };
    });
  }
  async create(input: NewSharedChannel): Promise<string> {
    const row = record(input);
    const name = text(row.name, 80, "channel name").trim();
    const description = text(row.description, 1000, "description", true);
    if (row.visibility !== "open" && row.visibility !== "private") throw new Error("Invalid channel visibility.");
    const result = accepted(await this.command(["channels", "create", `--name=${name}`, "--type", "stream", "--visibility", row.visibility, `--description=${description}`]));
    return identifier(result.channel_id, "channel");
  }
  async details(channelId: string, name: string): Promise<SharedChannelDetails | undefined> {
    const id = identifier(channelId, "channel");
    const query = text(name, 500, "channel name");
    const result = rows(await this.command(["channels", "search", `--query=${query}`, "--exact", "--include-archived", "--limit", "1000"]), 1000).map(record).find((row) => row.channel_id === id);
    if (!result) return undefined;
    if (typeof result.archived !== "boolean") throw new Error("Unsupported channel archive state.");
    return { id, name: text(result.name, 500, "channel name"), description: text(result.about ?? "", 4000, "description", true),
      visibility: result.visibility === "public" || result.visibility === "private" ? result.visibility : undefined,
      channelType: result.channel_type == null ? undefined : text(result.channel_type, 40, "channel type"), archived: result.archived,
      topic: result.topic == null ? undefined : text(result.topic, 4000, "topic", true), purpose: result.purpose == null ? undefined : text(result.purpose, 4000, "purpose", true) };
  }
  async update(input: ChannelUpdate): Promise<void> {
    const row = record(input);
    const id = identifier(row.channelId, "channel");
    const name = text(row.name, 80, "channel name").trim();
    const description = text(row.description, 1000, "description", true);
    accepted(await this.command(["channels", "update", "--channel", id, `--name=${name}`, `--description=${description}`]));
  }
  async manage(channelId: string, action: ChannelManagementAction): Promise<void> {
    if (!["archive", "unarchive", "delete"].includes(action)) throw new Error("Invalid channel action.");
    accepted(await this.command(["channels", action, "--channel", identifier(channelId, "channel")]));
  }
  async reactions(messageId: string): Promise<ChannelReaction[]> {
    const id = identifier(messageId, "message");
    const connection = this.connection;
    const response = record(await this.command(["reactions", "get", "--event", id]));
    // The CLI resolves its own public identity; never send the private key to the renderer.
    const identity = await (this.identity ??= this.command(["users", "get"]).then((value) => {
      const profiles = rows(value, 1);
      return profiles.length ? identifier(record(profiles[0]).pubkey, "identity") : undefined;
    }).catch(() => undefined));
    if (this.connection !== connection) throw new Error("The channel connection changed.");
    return rows(response.reactions, 200).map((value) => {
      const row = record(value);
      const pubkeys = new Set(rows(row.pubkeys, 2000).map((key) => identifier(key, "identity")));
      return { emoji: text(row.emoji, 64, "reaction"), count: pubkeys.size, ...(identity ? { mine: pubkeys.has(identity) } : {}) };
    }).filter((reaction) => reaction.count > 0);
  }
  async react(messageId: string, emoji: string, action: "add" | "remove"): Promise<void> {
    const id = identifier(messageId, "message");
    if (action !== "add" && action !== "remove") throw new Error("Invalid reaction action.");
    const content = text(emoji, 64, "reaction");
    accepted(await this.command(["reactions", action, "--event", id, `--emoji=${content}`]));
  }
  async membership(channelId: string, action: "join" | "leave"): Promise<void> {
    if (action !== "join" && action !== "leave") throw new Error("Invalid membership action.");
    accepted(await this.command(["channels", action, "--channel", identifier(channelId, "channel")]));
  }
  async invite(input: ChannelInvitation): Promise<void> {
    const row = record(input);
    if (row.role !== "member" && row.role !== "bot") throw new Error("Invalid member role.");
    accepted(await this.command(["channels", "add-member", "--channel", identifier(row.channelId, "channel"), "--pubkey", identifier(row.pubkey, "identity"), "--role", row.role]));
  }
  async removeMember(channelId: string, pubkey: string): Promise<void> {
    accepted(await this.command(["channels", "remove-member", "--channel", identifier(channelId, "channel"), "--pubkey", identifier(pubkey, "identity")]));
  }
  async members(channelId: string): Promise<ChannelMember[]> {
    const members = rows(await this.command(["channels", "members", "--channel", identifier(channelId, "channel")]), 200).map((item) => {
      const row = record(item);
      const pubkey = identifier(row.pubkey, "identity");
      return { pubkey, name: `${pubkey.slice(0, 12)}…`, role: text(row.role, 40, "member role") };
    });
    if (!members.length) return members;
    const profiles = rows(await this.command(["users", "get", ...members.flatMap((member) => ["--pubkey", member.pubkey])]), 200).map(record);
    return members.map((member) => {
      const profile = profiles.find((profile) => profile.pubkey === member.pubkey);
      const name = profile?.display_name || profile?.name;
      const picture = typeof profile?.picture === "string" && profile.picture.length <= 360_000 ? profile.picture : undefined;
      if (picture) this.pictures.set(member.pubkey, picture); else this.pictures.delete(member.pubkey);
      let pictureBytes = [...this.pictures.values()].reduce((total, value) => total + value.length, 0);
      while (this.pictures.size > 200 || pictureBytes > 2 * 1024 * 1024) {
        const oldest = this.pictures.keys().next().value!;
        pictureBytes -= this.pictures.get(oldest)!.length; this.pictures.delete(oldest);
      }
      return { ...member, name: typeof name === "string" && name.trim() ? name.slice(0, 160) : member.name, ...(picture ? { picture } : {}) };
    });
  }
  async avatar(pubkey: string): Promise<string | undefined> {
    const picture = this.pictures.get(identifier(pubkey, "identity"));
    const connection = this.connection;
    if (!this.connected || !connection || !picture) return;
    const image = await this.avatars.get(picture, connection.url, this.controller.signal);
    return this.connection === connection ? image : undefined;
  }
  async messages(channelId: string, parent?: string): Promise<ChannelMessage[]> {
    const channel = identifier(channelId, "channel");
    const thread = parent === undefined ? undefined : identifier(parent, "message");
    const args = parent === undefined
      ? ["messages", "get", "--channel", channel, "--limit", "100", "--kinds", "9,45001,45003"]
      : ["messages", "thread", "--channel", channel, "--event", thread!, "--limit", "100"];
    const unique = new Map<string, ChannelMessage>();
    for (const item of rows(await this.command(args), 101)) {
      const row = record(item);
      if (![9, 45001, 45003].includes(Number(row.kind))) continue;
      const tags = rows(row.tags, 512).filter((tag): tag is string[] => Array.isArray(tag) && tag.every((value) => typeof value === "string"));
      // Even a well-formed response cannot move a message between channels.
      if (tags.find((tag) => tag[0] === "h")?.[1] !== channel) throw new Error("The relay returned a message from another channel.");
      const refs = tags.filter((tag) => tag[0] === "e" && HEX.test(tag[1] ?? ""));
      const replyTo = refs.find((tag) => tag[3] === "reply")?.[1]?.toLowerCase();
      // A root-only reference is a top-level citation, not a reply.
      const rootId = replyTo ? refs.find((tag) => tag[3] === "root")?.[1]?.toLowerCase() ?? replyTo : undefined;
      const id = identifier(row.id, "message");
      if (thread && id !== thread && rootId !== thread && replyTo !== thread) throw new Error("The relay returned a message from another thread.");
      if (typeof row.created_at !== "number" || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || row.created_at > 8.64e12) throw new Error("Invalid message time.");
      const mentions = [...new Set(tags.filter((tag) => tag[0] === "p" && HEX.test(tag[1] ?? "")).map((tag) => tag[1]!.toLowerCase()))];
      unique.set(id, { id, author: identifier(row.pubkey, "identity"), content: text(row.content, 64_000, "message", true), createdAt: row.created_at, rootId, replyTo, ...(mentions.length ? { mentions } : {}) });
    }
    return [...unique.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }
  async post(input: ChannelPost): Promise<string> {
    const row = record(input);
    const channel = identifier(row.channelId, "channel");
    const content = text(row.content, 16_000, "message");
    const mentions = [...new Set(rows(row.mentions, 20).map((value) => identifier(value, "identity")))];
    const args = ["messages", "send", "--channel", channel, "--content", "-", "--kind", "9"];
    if (row.replyTo !== undefined) args.push("--reply-to", identifier(row.replyTo, "message"));
    for (const mention of mentions) args.push("--mention", mention);
    const result = accepted(await this.command(args, content));
    return identifier(result.event_id, "message");
  }
}
