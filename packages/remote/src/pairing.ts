import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { IpcScope } from "@capsule/shared";

/*
 * Pairing another device with this Capsule.
 *
 * The rules that matter are all here, away from the transport: a grant is
 * single use and short lived, a session carries the scopes the grant was
 * issued with, and nothing is ever compared with ===.
 */

/** How long a printed pairing link is worth anything. */
export const GRANT_TTL_MS = 5 * 60_000;
/** How long a paired device stays paired without being used. */
export const SESSION_TTL_MS = 12 * 60 * 60_000;
/**
 * A phone pairing lasts thirty days from its last connection. A phone is a
 * device someone keeps, over a pinned channel; making it re-pair every
 * morning is what gets an app deleted. Browser tabs keep the short limit.
 */
export const PHONE_SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/**
 * Which listener a grant or session belongs to. A phone pairing is made for
 * the pinned TLS listener and is refused on the plain one, so a control
 * token can never be spent over a connection anyone on the network can read.
 */
export type RemoteTransport = "browser" | "phone";

export interface PairingGrant {
  id: string;
  transport?: RemoteTransport;
  /** Only the hash is kept: a stolen store cannot be replayed as a link. */
  tokenHash: string;
  scopes: IpcScope[];
  expiresAt: number;
  consumedAt?: number;
}

export interface RemoteSession {
  id: string;
  transport?: RemoteTransport;
  tokenHash: string;
  scopes: IpcScope[];
  label: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

/** A URL-safe secret with 160 bits of entropy. */
export function createToken(): string {
  return randomBytes(20).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, so a wrong guess tells you nothing by timing. */
export function tokenMatches(token: string, hash: string): boolean {
  const candidate = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function issueGrant(input: {
  scopes: IpcScope[];
  now?: number;
  token?: string;
  transport?: RemoteTransport;
}): { grant: PairingGrant; token: string } {
  const now = input.now ?? Date.now();
  const token = input.token ?? createToken();
  return {
    token,
    grant: {
      id: `grant_${randomBytes(6).toString("hex")}`,
      tokenHash: hashToken(token),
      scopes: [...input.scopes],
      expiresAt: now + GRANT_TTL_MS,
      ...(input.transport === "phone" ? { transport: "phone" as const } : {}),
    },
  };
}

export type ExchangeFailure = "unknown" | "expired" | "consumed";

/**
 * Trades a pairing token for a session. The grant is consumed whether or not
 * the caller keeps the result — a link that has been clicked once is spent,
 * which is the whole point of printing it.
 */
export function exchangeGrant(input: {
  grants: PairingGrant[];
  token: string;
  label: string;
  now?: number;
}): { session: RemoteSession; token: string } | { error: ExchangeFailure } {
  const now = input.now ?? Date.now();
  const grant = input.grants.find((candidate) => tokenMatches(input.token, candidate.tokenHash));
  if (!grant) return { error: "unknown" };
  if (grant.consumedAt) return { error: "consumed" };
  if (grant.expiresAt <= now) return { error: "expired" };
  grant.consumedAt = now;

  const token = createToken();
  return {
    token,
    session: {
      id: `remote_${randomBytes(6).toString("hex")}`,
      ...(grant.transport === "phone" ? { transport: "phone" as const } : {}),
      tokenHash: hashToken(token),
      scopes: [...grant.scopes],
      label: input.label.slice(0, 80) || "Paired device",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + (grant.transport === "phone" ? PHONE_SESSION_TTL_MS : SESSION_TTL_MS),
    },
  };
}

/** The session a bearer token belongs to, if it is still valid. */
export function resolveSession(
  sessions: RemoteSession[],
  token: string,
  now = Date.now(),
): RemoteSession | undefined {
  const session = sessions.find((candidate) => tokenMatches(token, candidate.tokenHash));
  if (!session || session.expiresAt <= now) return undefined;
  session.lastSeenAt = now;
  return session;
}

/** Drops what has expired. Called on every use so nothing lingers. */
export function pruneExpired<T extends { expiresAt: number }>(items: T[], now = Date.now()): T[] {
  return items.filter((item) => item.expiresAt > now);
}
