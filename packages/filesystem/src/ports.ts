import { spawnSync } from "node:child_process";
import http from "node:http";
import https from "node:https";
import type { LocalServer } from "@capsule/shared";

/**
 * Local servers that are currently listening.
 *
 * The browser surface opened on a hardcoded localhost:3000, which is right
 * about as often as a dev server happens to use that port. Listing what is
 * actually listening turns a guess into a choice.
 */

export interface ListeningPort {
  /** The listening port. */
  port: number;
  /** The process holding it, as the OS reports it. */
  command: string;
  pid: number;
}

/**
 * macOS and Linux daemons that listen on local ports and are never a thing
 * anyone wants to open in a browser. Everything else is shown: guessing which
 * of a developer's own processes counts as a "dev server" gets it wrong.
 */
const SYSTEM_PROCESSES = new Set([
  "rapportd",
  "ControlCe",
  "ControlCenter",
  "sharingd",
  "identitys",
  "remoted",
  "launchd",
  "mDNSRespo",
  "netbiosd",
  "AirPlayXP",
  "cupsd",
  "sshd",
]);

/** Addresses that mean "this machine", including the IPv6 loopback. */
function isLocalAddress(address: string): boolean {
  const host = address.slice(0, address.lastIndexOf(":"));
  return (
    host === "*" ||
    host === "" ||
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "[::1]" ||
    host === "*:*" ||
    host === "[::]"
  );
}

/**
 * Parse `lsof -iTCP -sTCP:LISTEN -P -n -F pcn`.
 *
 * The -F form is line-prefixed and stable, unlike lsof's columnar default
 * which shifts with long process names: `p` sets the pid, `c` the command,
 * and each `n` is one address the current process is listening on.
 */
export function parseLsofPorts(output: string): ListeningPort[] {
  const seen = new Map<number, ListeningPort>();
  let pid = 0;
  let command = "";

  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      pid = Number(value) || 0;
      command = "";
      continue;
    }
    if (tag === "c") {
      command = value;
      continue;
    }
    if (tag !== "n") continue;
    if (!isLocalAddress(value)) continue;
    const port = Number(value.slice(value.lastIndexOf(":") + 1));
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    if (SYSTEM_PROCESSES.has(command)) continue;
    // One process can hold the same port on several descriptors.
    if (!seen.has(port)) {
      seen.set(port, { port, command, pid });
    }
  }

  return [...seen.values()].sort((a, b) => a.port - b.port);
}

/** Empty when lsof is unavailable — a missing list is better than a wrong one. */
export function listListeningPorts(): ListeningPort[] {
  try {
    const result = spawnSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"], {
      encoding: "utf8",
      timeout: 4_000,
    });
    return parseLsofPorts(result.stdout ?? "");
  } catch {
    return [];
  }
}

export function parsePageTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, " ").trim();
  return title ? title.slice(0, 100) : undefined;
}

function probe(
  candidate: ListeningPort,
  protocol: "http" | "https",
  timeoutMs: number,
): Promise<LocalServer | undefined> {
  const client = protocol === "https" ? https : http;
  return new Promise((resolve) => {
    const request = client.get(
      {
        host: "127.0.0.1",
        port: candidate.port,
        path: "/",
        headers: { Accept: "text/html,*/*;q=0.8", Host: `localhost:${candidate.port}` },
        timeout: timeoutMs,
        ...(protocol === "https" ? { rejectUnauthorized: false } : {}),
      },
      (response) => {
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 400 || (!contentType.includes("text/html") && status < 300)) {
          response.resume();
          resolve(undefined);
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          if (body.length < 64_000) body += chunk.slice(0, 64_000 - body.length);
        });
        response.on("end", () =>
          resolve({
            ...candidate,
            protocol,
            url: `${protocol}://localhost:${candidate.port}`,
            title: parsePageTitle(body),
          }),
        );
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(undefined));
  });
}

export async function probeLocalServer(
  candidate: ListeningPort,
  timeoutMs = 700,
): Promise<LocalServer | undefined> {
  const plain = await probe(candidate, "http", timeoutMs);
  return plain ?? probe(candidate, "https", timeoutMs);
}

/**
 * Discover local HTTP applications, not merely every process with a socket.
 * Probes stay on loopback, are bounded, and return only endpoints that answer
 * like web servers, so databases and the OpenClaw Gateway do not become links.
 */
export async function listLocalServers(timeoutMs = 700): Promise<LocalServer[]> {
  const candidates = listListeningPorts().slice(0, 80);
  const servers = await Promise.all(
    candidates.map((candidate) => probeLocalServer(candidate, timeoutMs)),
  );
  return servers.filter((server): server is LocalServer => Boolean(server));
}
