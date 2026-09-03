import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createKeychainAdapter, type SecretEncryptor } from "./keychain.js";

/** A stand-in for Electron's safeStorage: reversible, and obviously not plain. */
function fakeEncryptor(available = true): SecretEncryptor {
  return {
    isAvailable: () => available,
    encryptString: (plain) => Buffer.from(`x${plain}`, "utf8"),
    decryptString: (buffer) => buffer.toString("utf8").slice(1),
  };
}

const SERVICE = "ai.capsule.desktop";

describe("secret storage", () => {
  it("does not leave the secret readable on disk", async () => {
    // This file holds the Gateway operator token. It was plain JSON, and the
    // settings screen called it the Keychain.
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-secrets-"));
    const store = createKeychainAdapter(dir, fakeEncryptor());
    await store.set(SERVICE, "token", "super-secret-value");

    const onDisk = readFileSync(path.join(dir, "secrets", "secrets.json"), "utf8");
    expect(onDisk).not.toContain("super-secret-value");
    expect(await store.get(SERVICE, "token")).toBe("super-secret-value");
  });

  it("still reads a secret written before encryption existed", async () => {
    // Upgrading must not silently sign someone out of their Gateway.
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-secrets-"));
    const plain = createKeychainAdapter(dir);
    await plain.set(SERVICE, "token", "written-before");

    const encrypted = createKeychainAdapter(dir, fakeEncryptor());
    expect(await encrypted.get(SERVICE, "token")).toBe("written-before");

    // And the next write puts it away properly.
    await encrypted.set(SERVICE, "token", "written-after");
    const onDisk = readFileSync(path.join(dir, "secrets", "secrets.json"), "utf8");
    expect(onDisk).not.toContain("written-after");
  });

  it("falls back to a plain file when the host cannot encrypt", async () => {
    // Refusing to store the token at all would be worse than storing it the
    // way it has always been stored.
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-secrets-"));
    const store = createKeychainAdapter(dir, fakeEncryptor(false));
    await store.set(SERVICE, "token", "no-keychain-here");
    expect(await store.get(SERVICE, "token")).toBe("no-keychain-here");
  });

  it("treats a value it cannot decrypt as gone, not as a crash", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-secrets-"));
    await createKeychainAdapter(dir, fakeEncryptor()).set(SERVICE, "token", "v");
    const otherMachine = createKeychainAdapter(dir, {
      isAvailable: () => true,
      encryptString: () => Buffer.from(""),
      decryptString: () => {
        throw new Error("wrong key");
      },
    });
    expect(await otherMachine.get(SERVICE, "token")).toBeUndefined();
  });

  it("forgets a deleted secret", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "capsule-secrets-"));
    const store = createKeychainAdapter(dir, fakeEncryptor());
    await store.set(SERVICE, "token", "v");
    await store.delete(SERVICE, "token");
    expect(await store.get(SERVICE, "token")).toBeUndefined();
  });
});
