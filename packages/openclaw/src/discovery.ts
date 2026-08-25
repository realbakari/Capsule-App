import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_GATEWAY_HOST = "127.0.0.1";
export const DEFAULT_GATEWAY_PORT = 18789;
export const DEFAULT_GATEWAY_URL = `ws://${DEFAULT_GATEWAY_HOST}:${DEFAULT_GATEWAY_PORT}`;

export interface GatewayEndpoint {
  url: string;
  host: string;
  port: number;
  source: "config" | "default" | "manual";
}

export function parseGatewayUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url.includes("://") ? url : `ws://${url}`);
  const port = parsed.port ? Number(parsed.port) : DEFAULT_GATEWAY_PORT;
  return { host: parsed.hostname || DEFAULT_GATEWAY_HOST, port };
}

export function readOpenClawGatewayHint(): GatewayEndpoint | undefined {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const json = JSON.parse(raw) as {
      gateway?: { port?: number; bind?: string; remote?: { url?: string } };
    };
    if (json.gateway?.remote?.url) {
      const parsed = parseGatewayUrl(json.gateway.remote.url);
      return {
        url: json.gateway.remote.url,
        host: parsed.host,
        port: parsed.port,
        source: "config",
      };
    }
    const port = json.gateway?.port ?? DEFAULT_GATEWAY_PORT;
    return {
      url: `ws://${DEFAULT_GATEWAY_HOST}:${port}`,
      host: DEFAULT_GATEWAY_HOST,
      port,
      source: "config",
    };
  } catch {
    return undefined;
  }
}

export function defaultGatewayEndpoint(overrideUrl?: string): GatewayEndpoint {
  if (overrideUrl) {
    const parsed = parseGatewayUrl(overrideUrl);
    return {
      url: overrideUrl.includes("://") ? overrideUrl : `ws://${overrideUrl}`,
      host: parsed.host,
      port: parsed.port,
      source: "manual",
    };
  }
  return (
    readOpenClawGatewayHint() ?? {
      url: DEFAULT_GATEWAY_URL,
      host: DEFAULT_GATEWAY_HOST,
      port: DEFAULT_GATEWAY_PORT,
      source: "default",
    }
  );
}

export function probeTcp(host: string, port: number, timeoutMs = 750): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}
