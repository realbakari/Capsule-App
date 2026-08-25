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

function openClawConfigPath(): string {
  return path.join(os.homedir(), ".openclaw", "openclaw.json");
}

function readOpenClawConfig(): {
  gateway?: {
    port?: number;
    bind?: string;
    remote?: { url?: string };
    auth?: { token?: string };
  };
} | undefined {
  const configPath = openClawConfigPath();
  if (!fs.existsSync(configPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as {
      gateway?: {
        port?: number;
        bind?: string;
        remote?: { url?: string };
        auth?: { token?: string };
      };
    };
  } catch {
    return undefined;
  }
}

export function readOpenClawGatewayHint(): GatewayEndpoint | undefined {
  const json = readOpenClawConfig();
  if (!json) return undefined;
  try {
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

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Shared Gateway token from the local OpenClaw config. Used only for loopback. */
export function readLocalGatewayBootstrapToken(host: string): string | undefined {
  if (!isLoopbackHost(host)) return undefined;
  const token = readOpenClawConfig()?.gateway?.auth?.token?.trim();
  return token && token.length > 0 ? token : undefined;
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
