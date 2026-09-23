import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "@capsule/filesystem";
import type { RelayCredentialStore } from "@capsule/buzz";
import type { SecretEncryptor } from "./keychain.js";

/** Dedicated encrypted file: relay identities must never use the older token
 * store's plaintext fallback. The URL and key form one atomic credential. */
export function createRelayCredentialStore(userDataDir: string, encryptor?: SecretEncryptor): RelayCredentialStore {
  const file = path.join(userDataDir, "secrets", "shared-relay.json");
  const available = () => { try { return encryptor?.isAvailable() === true; } catch { return false; } };
  return {
    available,
    read() {
      if (!existsSync(file)) return undefined;
      if (!available()) throw new Error("Protected credential storage is unavailable.");
      try {
        const raw = readFileSync(file, "utf8");
        if (raw.length > 16_384) throw new Error("Oversized credential");
        const envelope = JSON.parse(raw) as { version?: unknown; ciphertext?: unknown };
        if (envelope.version !== 1 || typeof envelope.ciphertext !== "string") throw new Error("Unsupported credential");
        const value = JSON.parse(encryptor!.decryptString(Buffer.from(envelope.ciphertext, "base64"))) as { url?: unknown; privateKey?: unknown };
        if (typeof value.url !== "string" || typeof value.privateKey !== "string") throw new Error("Invalid credential");
        return { url: value.url, privateKey: value.privateKey };
      } catch { throw new Error("The saved relay identity cannot be opened."); }
    },
    write(credentials) {
      if (!available()) throw new Error("Protected credential storage is unavailable.");
      try {
        const ciphertext = encryptor!.encryptString(JSON.stringify(credentials)).toString("base64");
        writeFileAtomic(file, JSON.stringify({ version: 1, ciphertext }), { mode: 0o600 });
      } catch { throw new Error("The relay identity could not be saved securely."); }
    },
    clear() { rmSync(file, { force: true }); },
  };
}
