import fs from "node:fs";
import { writeFileAtomic } from "@capsule/filesystem";
import os from "node:os";
import path from "node:path";

export interface KeychainAdapter {
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

/**
 * The platform's own secret storage, when the host provides one.
 *
 * Electron's `safeStorage` encrypts with a key held in the macOS Keychain, so
 * the file on disk is useless to another process reading it. The engine cannot
 * import Electron, so the desktop passes this in.
 */
export interface SecretEncryptor {
  isAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Marks a stored value as ciphertext, so a plaintext one can be told apart. */
const ENCRYPTED_PREFIX = "enc:v1:";

/*
 * Secrets on disk, encrypted where the host can encrypt them.
 *
 * This file holds the Gateway operator token and the skills.sh token, and the
 * settings screen has always described it as the Keychain. It was a plaintext
 * JSON file — mode 0600, but readable by anything running as the user and
 * carried along in any backup of Application Support. Now the value is
 * encrypted with a Keychain-held key when one is available, and a value
 * written before this change is read once as plaintext and re-encrypted on the
 * next write rather than being lost.
 */
function fileStore(dir: string, encryptor?: SecretEncryptor): KeychainAdapter {
  const file = path.join(dir, "secrets.json");
  const usable = () => {
    try {
      return Boolean(encryptor?.isAvailable());
    } catch {
      // A host that throws when asked cannot encrypt.
      return false;
    }
  };
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string>) => {
    // Atomic: a truncated secrets file is a signed-out Gateway with no way
    // back except pasting the token again.
    writeFileAtomic(file, JSON.stringify(data), { mode: 0o600 });
  };
  const keyFor = (service: string, account: string) => `${service}:${account}`;
  return {
    async get(service, account) {
      const stored = read()[keyFor(service, account)];
      if (stored === undefined) return undefined;
      if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;
      if (!usable()) return undefined;
      try {
        return encryptor!.decryptString(
          Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64"),
        );
      } catch {
        // A key that no longer opens this value — a restored backup, another
        // machine — means the secret is gone, not that the app is broken.
        return undefined;
      }
    },
    async set(service, account, secret) {
      const data = read();
      data[keyFor(service, account)] = usable()
        ? `${ENCRYPTED_PREFIX}${encryptor!.encryptString(secret).toString("base64")}`
        : secret;
      write(data);
    },
    async delete(service, account) {
      const data = read();
      delete data[keyFor(service, account)];
      write(data);
    },
  };
}

export function createKeychainAdapter(
  userDataDir?: string,
  encryptor?: SecretEncryptor,
): KeychainAdapter {
  const fallbackDir = path.join(userDataDir ?? path.join(os.homedir(), ".capsule"), "secrets");
  return fileStore(fallbackDir, encryptor);
}

export const CAPSULE_KEYCHAIN_SERVICE = "ai.capsule.desktop";
export const GATEWAY_TOKEN_ACCOUNT = "openclaw.gateway.token";
export const SKILLS_SH_TOKEN_ACCOUNT = "skills.sh.token";
