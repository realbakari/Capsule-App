import { describe, expect, it, vi } from "vitest";
import { SharedRelayClient, relayUrl, type RelayCredentialStore } from "./relay.js";
import type { RelayBytes, RelayCommand } from "./cli.js";

const channelId = "11111111-2222-3333-4444-555555555555";
const publicKey = "a".repeat(64);
const messageId = "b".repeat(64);
const privateKey = "c".repeat(64);
async function fixture() {
  const command = vi.fn<RelayCommand>().mockResolvedValue([]);
  const client = new SharedRelayClient(command);
  await client.connect({ url: "https://relay.example", privateKey });
  command.mockClear();
  return { client, command };
}
describe("shared relay boundary", () => {
  it("carries inert emoji artwork from raw profile events without requesting image bytes", async () => {
    const { client, command } = await fixture();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FFE75C"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="258">😆</text></svg>';
    command.mockResolvedValueOnce([{ pubkey: publicKey, role: "owner" }]).mockResolvedValueOnce([{ pubkey: publicKey, content: JSON.stringify({ name: "Alex", picture: `data:image/svg+xml,${encodeURIComponent(svg)}` }) }]);
    expect(await client.members(channelId)).toEqual([{ pubkey: publicKey, name: "Alex", role: "owner", emojiAvatar: { emoji: "😆", color: "#FFE75C" } }]);
    expect(await client.avatar(publicKey)).toBeUndefined();
    expect(command).toHaveBeenCalledTimes(2);
  });
  it("coalesces duplicate reads and queues a fifth distinct request instead of dropping members", async () => {
    const { client, command } = await fixture();
    const completions: Array<(value: unknown) => void> = [];
    command.mockImplementation(() => new Promise((resolve) => completions.push(resolve)));
    const reads = Array.from({ length: 6 }, (_, index) => client.messages(`${index}1111111-2222-3333-4444-555555555555`));
    const duplicate = client.messages("01111111-2222-3333-4444-555555555555");
    const members = client.members(channelId);
    await Promise.resolve();
    expect(command).toHaveBeenCalledTimes(4);
    completions[0]!([]); completions[1]!([]); completions[2]!([]);
    await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(7));
    for (const finish of completions) finish([]);
    expect(await members).toEqual([]);
    await Promise.all([...reads, duplicate]);
    expect(command).toHaveBeenCalledTimes(7);
  });
  it("never coalesces writes", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: true });
    await Promise.all([client.membership(channelId, "join"), client.membership(channelId, "join")]);
    expect(command).toHaveBeenCalledTimes(2);
  });
  it("reads exact channel details without inferring unknown visibility or confusing duplicate names", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue([{ channel_id: "22222222-2222-3333-4444-555555555555", name: "General", archived: true }, { channel_id: channelId, name: "General", about: "Shared work", visibility: "private", archived: false, channel_type: "stream" }]);
    expect(await client.details(channelId, "General")).toMatchObject({ id: channelId, name: "General", description: "Shared work", visibility: "private", archived: false });
    expect(command.mock.calls[0]![1]).toContain("--include-archived");
    command.mockResolvedValue([]); expect(await client.details(channelId, "General")).toBeUndefined();
  });
  it("validates management writes and requires acceptance", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: true });
    await client.update({ channelId, name: "--help", description: "About" });
    expect(command.mock.calls[0]![1]).toEqual(["channels", "update", "--channel", channelId, "--name=--help", "--description=About"]);
    for (const action of ["archive", "unarchive", "delete"] as const) await client.manage(channelId, action);
    command.mockResolvedValue({ accepted: false });
    await expect(client.manage(channelId, "delete")).rejects.toThrow("did not accept");
    command.mockClear();
    await expect(client.manage(channelId, "join" as "archive")).rejects.toThrow();
    await expect(client.update({ channelId, name: " ", description: "" })).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("normalizes reactions by identity and changes only the requested emoji", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValueOnce({ reactions: [{ emoji: "👍", count: 3, pubkeys: [publicKey, publicKey, privateKey] }] }).mockResolvedValueOnce([{ pubkey: publicKey }]);
    expect(await client.reactions(messageId)).toEqual([{ emoji: "👍", count: 2, mine: true }]);
    command.mockResolvedValue({ accepted: true });
    await client.react(messageId, "👍", "remove");
    expect(command.mock.calls.at(-1)![1]).toEqual(["reactions", "remove", "--event", messageId, "--emoji=👍"]);
    command.mockResolvedValue({ accepted: false });
    await expect(client.react(messageId, "👍", "add")).rejects.toThrow("did not accept");
    command.mockClear();
    await expect(client.react("--help", "👍", "add")).rejects.toThrow();
    await expect(client.react(messageId, "x".repeat(65), "add")).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("does not turn top-level citations into replies and carries signed mention IDs", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue([{ id: messageId, pubkey: publicKey, kind: 9, content: "Hi @Alex", created_at: 123, tags: [["h", channelId], ["e", privateKey, "", "root"], ["p", publicKey], ["p", "invalid"]] }]);
    expect((await client.messages(channelId))[0]).toMatchObject({ rootId: undefined, replyTo: undefined, mentions: [publicKey] });
  });
  it.each(["file:///tmp/key", "https://user:pass@example.test", "https://example.test/?token=secret", "http://example.test", "https://example.test/path", "https://example.test/#token", "not-a-url"])("rejects unsafe origin %s", (url) => {
    expect(() => relayUrl(url)).toThrow();
  });
  it("accepts secure origins and normalizes WebSocket relay addresses", () => {
    expect(relayUrl("wss://relay.example/")).toBe("https://relay.example");
    expect(relayUrl("ws://localhost:3000")).toBe("http://localhost:3000");
    expect(relayUrl("http://[::1]:3000")).toBe("http://[::1]:3000");
  });
  it("does not expose credentials in status and disconnect forgets the identity", async () => {
    const { client, command } = await fixture();
    expect(client.status()).toMatchObject({ connected: true, url: "https://relay.example", remembered: false, hasSaved: false });
    expect(JSON.stringify(client.status())).not.toContain(privateKey);
    client.disconnect();
    expect(client.status()).toMatchObject({ connected: false, url: undefined });
    await expect(client.channels()).rejects.toThrow("Connect a relay identity first");
    expect(command).not.toHaveBeenCalled();
  });
  it("requires a successful connection probe", async () => {
    const client = new SharedRelayClient(vi.fn<RelayCommand>().mockResolvedValue({ error: "unauthorized" }));
    await expect(client.connect({ url: "https://relay.example", privateKey })).rejects.toThrow();
    expect(client.status().connected).toBe(false);
  });
  it("rejects stale work after disconnect, including a pending connection", async () => {
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    const client = new SharedRelayClient((_config, _args, abort) => {
      signal = abort;
      return new Promise((done) => { resolve = done; });
    });
    const connecting = client.connect({ url: "https://relay.example", privateKey });
    await Promise.resolve();
    client.disconnect();
    expect(signal.aborted).toBe(true);
    resolve([]);
    await expect(connecting).rejects.toThrow("connection changed");
    expect(client.status().connected).toBe(false);
  });
  it("does not turn malformed membership data into an empty success", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValueOnce([{ channel_id: channelId, name: "General" }]).mockResolvedValueOnce({ channels: [] });
    await expect(client.channels()).rejects.toThrow();
  });
  it("joins visible channel metadata with membership", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValueOnce([{ channel_id: channelId, name: "General", description: "Project work" }]).mockResolvedValueOnce([{ channel_id: channelId }]);
    expect(await client.channels()).toEqual([{ id: channelId, name: "General", description: "Project work", joined: true }]);
  });
  it("requires accepted acknowledgments even when the CLI exits successfully", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: false, message: privateKey });
    await expect(client.post({ channelId, content: "Hello", mentions: [] })).rejects.toThrow("did not accept");
    await expect(client.membership(channelId, "join")).rejects.toThrow("did not accept");
    await expect(client.create({ name: "project", description: "", visibility: "private" })).rejects.not.toThrow(privateKey);
  });
  it("posts exact content via stdin, with identity-qualified mentions and reply target", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: true, event_id: messageId });
    const content = "Review `src/main.ts`\n$(echo literal)";
    expect(await client.post({ channelId, content, replyTo: messageId, mentions: [publicKey, publicKey] })).toBe(messageId);
    const call = command.mock.calls[0]!;
    expect(call[1]).toEqual(["messages", "send", "--channel", channelId, "--content", "-", "--kind", "9", "--reply-to", messageId, "--mention", publicKey]);
    expect(call[1]).not.toContain(privateKey);
    expect(call[3]).toBe(content);
  });
  it("creates private channels and permits literal option-like names", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: true, channel_id: channelId });
    expect(await client.create({ name: "--help", description: "A project", visibility: "private" })).toBe(channelId);
    expect(command.mock.calls[0]![1]).toContain("--name=--help");
  });
  it("validates all write arguments before running a command", async () => {
    const { client, command } = await fixture();
    await expect(client.membership(channelId, "delete" as "join")).rejects.toThrow();
    await expect(client.post({ channelId: "--help", content: "Hello", mentions: [] })).rejects.toThrow();
    await expect(client.post({ channelId, content: " ", mentions: [] })).rejects.toThrow();
    await expect(client.post({ channelId, content: "a".repeat(16_001), mentions: [] })).rejects.toThrow();
    await expect(client.invite({ channelId, pubkey: publicKey, role: "owner" as "bot" })).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("resolves member names without inferring that a person is an agent", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValueOnce([{ pubkey: publicKey, role: "member" }]).mockResolvedValueOnce([{ pubkey: publicKey, display_name: "Reviewer" }]);
    expect(await client.members(channelId)).toEqual([{ pubkey: publicKey, name: "Reviewer", role: "member" }]);
  });
  it("uses only pictures supplied by relay profiles and clears them on disconnect", async () => {
    const { client, command } = await fixture();
    const picture = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=";
    command.mockResolvedValueOnce([{ pubkey: publicKey, role: "bot" }]).mockResolvedValueOnce([{ pubkey: publicKey, display_name: "Reviewer", picture }]);
    expect(await client.members(channelId)).toEqual([{ pubkey: publicKey, name: "Reviewer", role: "bot", picture }]);
    expect(await client.avatar(publicKey)).toBe(picture);
  });
  it("reads avatar_url from a raw profile event and loads relay media through the signed client", async () => {
    const hash = "ab".repeat(32);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const bytes = vi.fn<RelayBytes>().mockResolvedValue(png);
    const command = vi.fn<RelayCommand>().mockResolvedValue([]);
    const client = new SharedRelayClient(command, undefined, bytes);
    await client.connect({ url: "https://relay.example", privateKey });
    command.mockClear();
    const media = `https://relay.example/media/${hash}.jpg`;
    command.mockResolvedValueOnce([{ pubkey: publicKey.toUpperCase(), role: "member" }]).mockResolvedValueOnce([{
      pubkey: publicKey.toUpperCase(),
      content: JSON.stringify({ display_name: "Reviewer", avatar_url: media }),
    }]);
    expect(await client.members(channelId)).toEqual([{ pubkey: publicKey, name: "Reviewer", role: "member", picture: media }]);
    expect(await client.avatar(publicKey)).toMatch(/^data:image\/png;base64,/);
    expect(await client.avatar(publicKey)).toMatch(/^data:image\/png;base64,/);
    expect(bytes).toHaveBeenCalledTimes(1);
    expect(bytes).toHaveBeenCalledWith(expect.objectContaining({ url: "https://relay.example" }), ["media", "get", media], expect.any(AbortSignal));
    expect(await client.avatar("d".repeat(64))).toBeUndefined();
    client.disconnect(); expect(await client.avatar(publicKey)).toBeUndefined();
  });
  it("removes only an explicitly selected member and requires relay acceptance", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue({ accepted: true });
    await client.removeMember(channelId, publicKey);
    expect(command.mock.calls[0]![1]).toEqual(["channels", "remove-member", "--channel", channelId, "--pubkey", publicKey]);
    command.mockResolvedValue({ accepted: false });
    await expect(client.removeMember(channelId, publicKey)).rejects.toThrow("did not accept");
    command.mockClear();
    await expect(client.removeMember(channelId, "--help")).rejects.toThrow();
    expect(command).not.toHaveBeenCalled();
  });
  it("renders channel text literally and derives thread references without running agents", async () => {
    const { client, command } = await fixture();
    const event = { id: messageId, pubkey: publicKey, kind: 9, content: "<script>example</script>", created_at: 123, tags: [["h", channelId], ["e", "d".repeat(64), "", "reply"]] };
    command.mockResolvedValue([event, event]);
    expect(await client.messages(channelId)).toEqual([{ id: messageId, author: publicKey, content: event.content, createdAt: 123, rootId: "d".repeat(64), replyTo: "d".repeat(64) }]);
    expect(command).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-channel events and invalid timestamps", async () => {
    const { client, command } = await fixture();
    command.mockResolvedValue([{ id: messageId, pubkey: publicKey, kind: 9, content: "Hello", created_at: 123, tags: [["h", "another-channel"]] }]);
    await expect(client.messages(channelId)).rejects.toThrow("another channel");
    command.mockResolvedValue([{ id: messageId, pubkey: publicKey, kind: 9, content: "Hello", created_at: Infinity, tags: [["h", channelId]] }]);
    await expect(client.messages(channelId)).rejects.toThrow("message time");
  });
  it("keeps replies inside the requested thread and normalizes signed references", async () => {
    const { client, command } = await fixture();
    const event = { id: messageId, pubkey: publicKey, kind: 9, content: "Reply", created_at: 123, tags: [["h", channelId], ["e", "D".repeat(64), "", "root"], ["e", "D".repeat(64), "", "reply"]] };
    command.mockResolvedValue([event]);
    expect((await client.messages(channelId, "d".repeat(64)))[0]!.rootId).toBe("d".repeat(64));
    await expect(client.messages(channelId, "e".repeat(64))).rejects.toThrow("another thread");
  });
});

function storageFixture() {
  let saved: { url: string; privateKey: string } | undefined;
  const storage: RelayCredentialStore = {
    available: () => true, read: vi.fn(() => saved),
    write: vi.fn((value) => { saved = { ...value }; }), clear: vi.fn(() => { saved = undefined; }),
  };
  return storage;
}
describe("remembered relay identity", () => {
  const credentials = { url: "https://relay.example", privateKey };
  it("restores once across client lifetimes without leaking keys or reconnecting after disconnect", async () => {
    const storage = storageFixture();
    const command = vi.fn<RelayCommand>().mockResolvedValue([]);
    const first = new SharedRelayClient(command, storage);
    await first.connect({ ...credentials, remember: true });
    first.disconnect();
    command.mockClear();
    const next = new SharedRelayClient(command, storage);
    expect(await next.restore()).toMatchObject({ connected: true, remembered: true, hasSaved: true, url: credentials.url });
    expect(JSON.stringify(next.status())).not.toContain(privateKey);
    next.disconnect();
    expect(await next.restore()).toMatchObject({ connected: false, remembered: true });
    expect(command).toHaveBeenCalledTimes(1);
    expect(await next.connect({ url: credentials.url, privateKey: "" })).toMatchObject({ connected: true });
    next.forget();
    expect(storage.clear).toHaveBeenCalledTimes(1);
    expect(await new SharedRelayClient(command, storage).restore()).toMatchObject({ connected: false, hasSaved: false });
  });
  it("can save a live connection without asking for its key again", async () => {
    const storage = storageFixture();
    const client = new SharedRelayClient(vi.fn<RelayCommand>().mockResolvedValue([]), storage);
    await client.connect(credentials);
    expect(storage.write).not.toHaveBeenCalled();
    expect(client.remember().remembered).toBe(true);
    expect(storage.write).toHaveBeenCalledWith(credentials);
    await client.connect({ url: "https://another.example", privateKey });
    expect(client.status()).toMatchObject({ remembered: false, hasSaved: true });
    client.disconnect();
    await expect(client.connect({ url: "https://another.example", privateKey: "" })).rejects.toThrow("identity key");
  });
  it("preserves saved details after a failed restore and permits explicit retry", async () => {
    const storage = storageFixture(); storage.write(credentials);
    const command = vi.fn<RelayCommand>().mockRejectedValue(new Error("offline"));
    const client = new SharedRelayClient(command, storage);
    expect(await client.restore()).toMatchObject({ connected: false, url: credentials.url, remembered: true, warning: expect.stringContaining("not been removed") });
    expect(storage.clear).not.toHaveBeenCalled();
    command.mockResolvedValue([]);
    expect(await client.connect({ url: credentials.url, privateKey: "" })).toMatchObject({ connected: true, warning: undefined });
  });
  it("does not resurrect a forgotten connection or stale warning after a pending restore", async () => {
    const storage = storageFixture(); storage.write(credentials);
    let done!: (value: unknown) => void;
    const client = new SharedRelayClient(() => new Promise((resolve) => { done = resolve; }), storage);
    const restoring = client.restore();
    await Promise.resolve();
    client.forget(); done([]);
    expect(await restoring).toMatchObject({ connected: false, url: undefined, warning: undefined, hasSaved: false });
  });
  it("reports failed saves without losing the live connection and failed deletion without claiming success", async () => {
    const storage = storageFixture();
    storage.write = () => { throw new Error(privateKey); };
    const client = new SharedRelayClient(vi.fn<RelayCommand>().mockResolvedValue([]), storage);
    expect(await client.connect({ ...credentials, remember: true })).toMatchObject({ connected: true, remembered: false, warning: expect.stringContaining("could not be saved") });
    expect(JSON.stringify(client.status())).not.toContain(privateKey);
    storage.clear = () => { throw new Error(privateKey); };
    expect(() => client.forget()).toThrow("Could not remove");
    expect(client.status().connected).toBe(true);
  });
  it("handles unavailable storage without plaintext fallback or leaking decryption errors", async () => {
    const storage = storageFixture();
    storage.available = () => false;
    storage.read = () => { throw new Error(privateKey); };
    const client = new SharedRelayClient(vi.fn<RelayCommand>().mockResolvedValue([]), storage);
    const status = await client.restore();
    expect(status).toMatchObject({ connected: false, canRemember: false, hasSaved: true });
    expect(JSON.stringify(status)).not.toContain(privateKey);
    await client.connect(credentials);
    expect(() => client.remember()).toThrow("unavailable");
    expect(storage.write).not.toHaveBeenCalled();
  });
});
