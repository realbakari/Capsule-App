import { writeFile } from "node:fs/promises";

import type { CapsuleEngine } from "@capsule/core";
import { ShareGrantStore } from "@capsule/database";
import type { RemoteServerHandle, ShareAccess } from "@capsule/remote";
import {
  aggregatePresence,
  safeFileName,
  viewedSessionId,
  SHARE_LINK_EXPIRY_MS,
  threadExportMarkdown,
  type CreatedShareLink,
  type ShareGrant,
  type ShareLinkExpiry,
  type ThreadMarkdownOptions,
  type ThreadPresence,
  type TurnDiffResult,
} from "@capsule/shared";
import { shareEvent, shareScopedCall, type ShareScopeDeps } from "./share-scope";

/*
 * Export, share links and presence, as the main process serves them. The
 * rules live in share-scope (what a link may read) and the store (what a link
 * is); this file only connects them to the engine, the remote listener and
 * the window.
 */

export interface ShareContext {
  engine: () => CapsuleEngine;
  remote: () => RemoteServerHandle | undefined;
  /** The handler the desktop window would reach for a channel. */
  call: (channel: string, args: unknown[]) => Promise<unknown>;
  /** Tells the window (and Settings) that links or viewers changed. */
  changed: () => void;
  saveDialog: (defaultName: string) => Promise<string | undefined>;
}

const stores = new WeakMap<CapsuleEngine, ShareGrantStore>();

function store(engine: CapsuleEngine): ShareGrantStore {
  let value = stores.get(engine);
  if (!value) stores.set(engine, value = new ShareGrantStore(engine.db));
  return value;
}

function scopeDeps(ctx: ShareContext): ShareScopeDeps {
  return {
    session: (id) => ctx.engine().repos.getSession(id),
    project: (id) => ctx.engine().getProject(id),
    run: (id) => ctx.engine().repos.getRun(id),
    sessionOfMessage: (id) => store(ctx.engine()).sessionOfMessage(id),
    call: ctx.call,
  };
}

/** What the remote listener asks about a share link. */
export function shareAccess(ctx: ShareContext): ShareAccess {
  const deps = scopeDeps(ctx);
  return {
    resolve: (token) => {
      const grant = store(ctx.engine()).resolve(token);
      if (!grant) return undefined;
      return { id: grant.id, sessionId: grant.sessionId, ...(grant.expiresAt ? { expiresAt: Date.parse(grant.expiresAt) } : {}) };
    },
    invoke: (grant, channel, args) => shareScopedCall(grant, channel, args, deps),
    event: (grant, event, payload) => shareEvent(grant, event, payload, deps),
  };
}

/** The share and presence half of the remote listener's options. */
export function remoteShareOptions(ctx: ShareContext): { share: ShareAccess; viewing: typeof viewedSessionId } {
  return { share: shareAccess(ctx), viewing: viewedSessionId };
}

function readOptions(value: unknown): ThreadMarkdownOptions {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { includeToolActivity: record.includeToolActivity === true, includeChangedFiles: record.includeChangedFiles === true };
}

function readSessionId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200) throw new Error("Choose a conversation.");
  return value;
}

export async function buildThreadMarkdown(engine: CapsuleEngine, sessionId: string, options: ThreadMarkdownOptions): Promise<string> {
  const session = engine.repos.getSession(sessionId);
  if (!session) throw new Error("That conversation no longer exists.");
  const messages = engine.listMessages(sessionId);
  const runs = engine.listRuns(sessionId);
  const agentId = session.harnessId ?? session.agentId;
  const agentName = await engine.listAgents().then((agents) => agents.find((agent) => agent.id === agentId)?.name, () => undefined);
  const events = options.includeToolActivity ? runs.flatMap((run) => engine.listRunEvents(run.id)) : undefined;
  const changedFiles: Record<string, TurnDiffResult["files"]> = {};
  if (options.includeChangedFiles) {
    for (const run of runs) {
      if (!run.checkpointRef) continue;
      // A turn whose snapshots are gone exports without its file list, not as a failed export.
      const diff = await engine.turnDiff(run.id, { summaryOnly: true }).catch(() => undefined);
      if (diff?.files.length) changedFiles[run.id] = diff.files;
    }
  }
  return threadExportMarkdown(session, messages, runs, {
    ...options,
    ...(agentName ? { agentName } : {}),
    projectName: engine.getProject(session.projectId)?.name,
    ...(events ? { events } : {}),
    changedFiles,
  });
}

export function exportFileName(title: string): string {
  return `${safeFileName(title).slice(0, 80) || "Conversation"}.md`;
}

function expiresAt(expiry: unknown, now = Date.now()): string | undefined {
  if (typeof expiry !== "string" || !Object.hasOwn(SHARE_LINK_EXPIRY_MS, expiry)) throw new Error("Choose how long the link lasts.");
  const ms = SHARE_LINK_EXPIRY_MS[expiry as ShareLinkExpiry];
  return ms === undefined ? undefined : new Date(now + ms).toISOString();
}

export function registerShareHandlers(handle: (channel: string, fn: (...args: unknown[]) => unknown) => void, channels: {
  threadMarkdown: string; exportThreadMarkdown: string; createShareLink: string; listShareLinks: string; revokeShareLink: string; threadPresence: string;
}, ctx: ShareContext): void {
  handle(channels.threadMarkdown, (sessionId, options) => buildThreadMarkdown(ctx.engine(), readSessionId(sessionId), readOptions(options)));

  handle(channels.exportThreadMarkdown, async (sessionId, options): Promise<{ saved: boolean; path?: string }> => {
    const id = readSessionId(sessionId);
    const session = ctx.engine().repos.getSession(id);
    if (!session) throw new Error("That conversation no longer exists.");
    const markdown = await buildThreadMarkdown(ctx.engine(), id, readOptions(options));
    const target = await ctx.saveDialog(exportFileName(session.title));
    if (!target) return { saved: false };
    await writeFile(target, markdown, "utf8");
    return { saved: true, path: target };
  });

  handle(channels.createShareLink, (sessionId, expiry, label): CreatedShareLink => {
    const id = readSessionId(sessionId);
    const remote = ctx.remote();
    if (!remote) throw new Error("Turn on remote access first.");
    if (!ctx.engine().repos.getSession(id)) throw new Error("That conversation no longer exists.");
    const { grant, token } = store(ctx.engine()).create({
      sessionId: id,
      expiresAt: expiresAt(expiry),
      ...(typeof label === "string" && label.trim() ? { label: label.trim() } : {}),
    });
    ctx.changed();
    // The secret rides in the fragment, which a browser never sends to a server.
    return { grant, url: `${remote.url}/#share=${token}` };
  });

  handle(channels.listShareLinks, (sessionId): ShareGrant[] =>
    store(ctx.engine()).listActive(sessionId === undefined ? undefined : readSessionId(sessionId)));

  handle(channels.revokeShareLink, (grantId): ShareGrant | undefined => {
    if (typeof grantId !== "string" || !grantId) throw new Error("Choose a link to revoke.");
    const grant = store(ctx.engine()).revoke(grantId);
    ctx.remote()?.revokeShare(grantId);
    ctx.changed();
    return grant;
  });

  handle(channels.threadPresence, (): ThreadPresence[] => aggregatePresence(ctx.remote()?.viewers() ?? []));
}
