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

export interface PairingGrant {
  id: string;
  /** Only the hash is kept: a stolen store cannot be replayed as a link. */
  tokenHash: string;
  scopes: IpcScope[];
  expiresAt: number;
  consumedAt?: number;
}

export interface RemoteSession {
  id: string;
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
      tokenHash: hashToken(token),
      scopes: [...grant.scopes],
      label: input.label.slice(0, 80) || "Paired device",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + SESSION_TTL_MS,
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
