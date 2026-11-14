import { createHash, randomBytes } from "node:crypto";

import { nowIso, shareGrantActive, type ShareGrant } from "@capsule/shared";
import type { CapsuleDatabase } from "./database.js";

/*
 * Share links, kept apart from the repositories: nothing else reads this
 * table, and the one rule that matters — only a hash of the secret is ever
 * written — is easier to see in a file that does nothing else.
 */

interface Row {
  id: string;
  session_id: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toGrant(row: Row): ShareGrant {
  return {
    id: row.id,
    sessionId: row.session_id,
    createdAt: row.created_at,
    ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    ...(row.label ? { label: row.label } : {}),
  };
}

const COLUMNS = "id, session_id, label, created_at, expires_at, revoked_at";

export class ShareGrantStore {
  constructor(private readonly db: CapsuleDatabase) {}

  /** Mints a link secret. It is returned here once and never again. */
  create(input: { sessionId: string; expiresAt?: string; label?: string; now?: string }): { grant: ShareGrant; token: string } {
    const token = randomBytes(20).toString("base64url");
    const grant: ShareGrant = {
      id: `share_${randomBytes(6).toString("hex")}`,
      sessionId: input.sessionId,
      createdAt: input.now ?? nowIso(),
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.label ? { label: input.label.slice(0, 80) } : {}),
    };
    this.db.sqlite.prepare(`INSERT INTO share_grants (id, session_id, token_hash, label, created_at, expires_at, revoked_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)`).run(grant.id, grant.sessionId, hash(token), grant.label ?? null, grant.createdAt, grant.expiresAt ?? null);
    return { grant, token };
  }

  /** The active grant a link secret belongs to; revoked, expired and unknown secrets all read as nothing. */
  resolve(token: string, now = Date.now()): ShareGrant | undefined {
    if (!token || token.length > 128) return undefined;
    const row = this.db.sqlite.prepare(`SELECT ${COLUMNS} FROM share_grants WHERE token_hash = ?`).get(hash(token)) as Row | undefined;
    const grant = row ? toGrant(row) : undefined;
    return grant && shareGrantActive(grant, now) ? grant : undefined;
  }

  get(id: string): ShareGrant | undefined {
    const row = this.db.sqlite.prepare(`SELECT ${COLUMNS} FROM share_grants WHERE id = ?`).get(id) as Row | undefined;
    return row ? toGrant(row) : undefined;
  }

  /** Links still working, newest first; one thread's or every thread's. */
  listActive(sessionId?: string, now = Date.now()): ShareGrant[] {
    const rows = (sessionId
      ? this.db.sqlite.prepare(`SELECT ${COLUMNS} FROM share_grants WHERE session_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id DESC`).all(sessionId)
      : this.db.sqlite.prepare(`SELECT ${COLUMNS} FROM share_grants WHERE revoked_at IS NULL ORDER BY created_at DESC, id DESC`).all()) as Row[];
    return rows.map(toGrant).filter((grant) => shareGrantActive(grant, now));
  }

  revoke(id: string, now = nowIso()): ShareGrant | undefined {
    this.db.sqlite.prepare("UPDATE share_grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(now, id);
    return this.get(id);
  }

  /** The thread a message belongs to, so a link can be held to its own thread's images. */
  sessionOfMessage(messageId: string): string | undefined {
    const row = this.db.sqlite.prepare("SELECT session_id FROM messages WHERE id = ?").get(messageId) as { session_id: string } | undefined;
    return row?.session_id;
  }
}
