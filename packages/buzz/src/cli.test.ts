import { afterEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execute }));
import { runRelayCommand } from "./cli.js";

const key = "a".repeat(64);
function fixture() {
  const stdin = { on: vi.fn(), end: vi.fn() };
  execute.mockReturnValue({ stdin });
  const controller = new AbortController();
  const promise = runRelayCommand({ privateKey: key, url: "https://relay.example" }, ["messages", "send", "--content", "-"], controller.signal, "literal $(echo text)");
  const [binary, args, options, complete] = execute.mock.calls.at(-1)! as [string, string[], Record<string, unknown>, (error: unknown, output: string) => void];
  return { stdin, controller, promise, binary, args, options, complete };
}
afterEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); });
describe("relay CLI process boundary", () => {
  it("keeps identity out of argv and text on stdin without inheriting another auth tag", async () => {
    vi.stubEnv("BUZZ_AUTH_TAG", "unrelated-identity");
    vi.stubEnv("UNRELATED_SECRET", "unrelated-secret");
    const call = fixture();
    call.complete(null, "[]");
    await expect(call.promise).resolves.toEqual([]);
    expect(call.binary).toMatch(/^buzz(?:\.exe)?$/);
    expect(call.args).toEqual(["--relay", "https://relay.example", "--format", "json", "messages", "send", "--content", "-"]);
    expect(call.options.env).toMatchObject({ BUZZ_PRIVATE_KEY: key });
    expect(call.options.env).not.toHaveProperty("BUZZ_AUTH_TAG");
    expect(call.options.env).not.toHaveProperty("UNRELATED_SECRET");
    expect(call.options.shell).toBeUndefined();
    expect(call.options.timeout).toBe(20_000);
    expect(call.options.signal).toBe(call.controller.signal);
    expect(call.stdin.end).toHaveBeenCalledWith("literal $(echo text)");
  });
  it.each(["ENOENT", 3, 1])("sanitizes native failure %s without leaking credentials", async (code) => {
    const call = fixture();
    call.complete(Object.assign(new Error(`raw private key ${key}`), { code }), key);
    await expect(call.promise).rejects.not.toThrow(key);
  });
  it("does not echo malformed output or an aborted operation", async () => {
    const call = fixture();
    call.complete(null, key);
    await expect(call.promise).rejects.toThrow("unsupported response");
    const aborted = fixture();
    aborted.controller.abort();
    aborted.complete(new Error(key), key);
    await expect(aborted.promise).rejects.toThrow("connection was closed");
  });
});
