import { mkdtempSync, readFileSync, statSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayCredentialStore } from "./relay-credentials.js";
import type { SecretEncryptor } from "./keychain.js";

const dirs: string[] = [];
const dir = () => { const value = mkdtempSync(path.join(tmpdir(), "capsule-relay-credentials-")); dirs.push(value); return value; };
afterEach(() => { for (const value of dirs.splice(0)) rmSync(value, { recursive: true, force: true }); });
const credentials = { url: "https://relay.example", privateKey: "a".repeat(64) };
// Test codec only. Production injects the OS-backed Electron encryptor.
const codec: SecretEncryptor = { isAvailable: () => true, encryptString: (text) => Buffer.from(text.split("").reverse().join("")), decryptString: (bytes) => bytes.toString().split("").reverse().join("") };

describe("relay credential persistence", () => {
  it("round trips across store lifetimes without plaintext URL/key", () => {
    const root = dir();
    createRelayCredentialStore(root, codec).write(credentials);
    expect(createRelayCredentialStore(root, codec).read()).toEqual(credentials);
    const file = path.join(root, "secrets/shared-relay.json");
    expect(readFileSync(file, "utf8")).not.toContain(credentials.privateKey);
    expect(readFileSync(file, "utf8")).not.toContain(credentials.url);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });
  it("never falls back to plaintext when protected storage is unavailable", () => {
    const root = dir();
    const store = createRelayCredentialStore(root);
    expect(store.available()).toBe(false);
    expect(store.read()).toBeUndefined();
    expect(() => store.write(credentials)).toThrow("unavailable");
    expect(existsSync(path.join(root, "secrets/shared-relay.json"))).toBe(false);
  });
  it("does not discard unreadable credentials and can explicitly forget them", () => {
    const root = dir(); const file = path.join(root, "secrets/shared-relay.json");
    createRelayCredentialStore(root, codec).write(credentials);
    const store = createRelayCredentialStore(root, { ...codec, decryptString: () => { throw new Error(credentials.privateKey); } });
    expect(() => store.read()).toThrow("cannot be opened");
    expect(existsSync(file)).toBe(true);
    const other = path.join(root, "secrets/other.json"); writeFileSync(other, "other credentials");
    store.clear();
    expect(existsSync(file)).toBe(false);
    expect(readFileSync(other, "utf8")).toBe("other credentials");
  });
  it("rejects malformed or oversized persisted envelopes", () => {
    const root = dir(); const store = createRelayCredentialStore(root, codec);
    store.write(credentials);
    const file = path.join(root, "secrets/shared-relay.json");
    for (const value of ["null", "{", JSON.stringify({ version: 2, ciphertext: "AAAA" }), "x".repeat(17_000)]) {
      writeFileSync(file, value); expect(() => store.read()).toThrow("cannot be opened");
    }
  });
});
