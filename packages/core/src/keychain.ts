import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface KeychainAdapter {
  get(service: string, account: string): Promise<string | undefined>;
  set(service: string, account: string, secret: string): Promise<void>;
  delete(service: string, account: string): Promise<void>;
}

function fileStore(dir: string): KeychainAdapter {
  const file = path.join(dir, "secrets.json");
  const read = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      return {};
    }
  };
  const write = (data: Record<string, string>) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
  };
  const keyFor = (service: string, account: string) => `${service}:${account}`;
  return {
    async get(service, account) {
      return read()[keyFor(service, account)];
    },
    async set(service, account, secret) {
      const data = read();
      data[keyFor(service, account)] = secret;
      write(data);
    },
    async delete(service, account) {
      const data = read();
      delete data[keyFor(service, account)];
      write(data);
    },
  };
}

export function createKeychainAdapter(userDataDir?: string): KeychainAdapter {
  const fallbackDir = path.join(userDataDir ?? path.join(os.homedir(), ".capsule"), "secrets");
  return fileStore(fallbackDir);
}

export const CAPSULE_KEYCHAIN_SERVICE = "ai.capsule.desktop";
export const GATEWAY_TOKEN_ACCOUNT = "openclaw.gateway.token";
export const SKILLS_SH_TOKEN_ACCOUNT = "skills.sh.token";
