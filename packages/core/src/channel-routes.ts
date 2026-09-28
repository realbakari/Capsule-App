import { createId, isHarnessId, type AgentMessage, type ChannelHarnessJob, type ChannelRouteInput, type ChannelRouteStatus, type CreateSessionInput, type Project, type Run, type Session, type SavedChannelRoute } from "@capsule/shared";
import type { SharedRelayClient } from "@capsule/buzz";

interface Workspace {
  getProject(id: string): Project | undefined;
  createSession(input: CreateSessionInput): Promise<Session>;
  sendMessage(input: AgentMessage): Promise<{ run: Run }>;
  listRuns(sessionId?: string): Run[];
  getRun(id: string): Run | undefined;
}
interface Store { getSetting(key: string): string | undefined; setSetting(key: string, value: string): void }
interface Turn { job: ChannelHarnessJob; root: string; prompt: string; phase: "queued" | "started" | "done" }
interface Route {
  id: string; url: string; author: string; configuration: ChannelRouteInput;
  since: number; seen: string[]; turns: Turn[]; error?: string;
}
const KEY = "channel-harness-routes-v1";
const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const EVENT = /^[a-f0-9]{64}$/i;
const PREFIX = /^@capsule(?:\s+|$)/i;
const ACTIVE = new Set(["queued", "running", "waiting", "approval_required"]);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function config(value: unknown): ChannelRouteInput {
  if (!record(value) || typeof value.channelId !== "string" || !ID.test(value.channelId)
    || typeof value.projectId !== "string" || !ID.test(value.projectId) || typeof value.harnessId !== "string" || !isHarnessId(value.harnessId)
    || typeof value.enabled !== "boolean") throw new Error("Choose a channel, project and harness.");
  return { channelId: value.channelId, projectId: value.projectId, harnessId: value.harnessId, enabled: value.enabled };
}
function readRoutes(raw?: string): Route[] {
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 16) throw new Error("Invalid saved channel routes.");
  return data.map((row: unknown) => {
    if (!record(row) || typeof row.id !== "string" || typeof row.url !== "string" || typeof row.author !== "string" || !EVENT.test(row.author)
      || typeof row.since !== "number" || !Number.isFinite(row.since) || !Array.isArray(row.seen) || !row.seen.every((id) => typeof id === "string" && EVENT.test(id))
      || !Array.isArray(row.turns) || row.turns.length > 200) throw new Error("Invalid saved channel route.");
    const configuration = config(row.configuration);
    const turns: Turn[] = row.turns.map((value: unknown) => {
      if (!record(value) || !record(value.job) || typeof value.root !== "string" || !EVENT.test(value.root) || typeof value.prompt !== "string") throw new Error("Invalid saved channel turn.");
      const job = value.job;
      if (typeof job.id !== "string" || typeof job.messageId !== "string" || !EVENT.test(job.messageId)
        || (job.sessionId !== undefined && typeof job.sessionId !== "string") || (job.runId !== undefined && typeof job.runId !== "string")) throw new Error("Invalid saved channel run.");
      // Never replay execution or uncertain delivery across a process restart.
      return { root: value.root, prompt: "", phase: "done", job: {
        id: job.id, messageId: job.messageId, channelId: configuration.channelId, projectId: configuration.projectId, harnessId: configuration.harnessId,
        sessionId: job.sessionId, runId: job.runId, status: "failed",
        publication: job.publication === "shared" ? "shared" : job.publication === "sharing" || job.publication === "uncertain" ? "uncertain" : "unshared",
        error: value.phase !== "done" ? "Interrupted by restart. Open the conversation; this message will not run or publish again automatically." : typeof job.error === "string" ? job.error : undefined,
      } };
    });
    return { id: row.id, url: row.url, author: row.author, configuration, since: row.since, seen: row.seen, turns,
      error: typeof row.error === "string" ? row.error : undefined };
  });
}

/** A message-to-session bridge. The workspace, not this bridge, owns agent execution. */
export class ChannelRoutes {
  private routes: Route[] = [];
  private recoveryError?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<void>;
  private closed = false;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly relay: SharedRelayClient, private readonly workspace: Workspace, private readonly store: Store) {
    try { this.routes = readRoutes(store.getSetting(KEY)); }
    catch { this.recoveryError = "Saved channel routes could not be read. They have not been overwritten; local channel execution is disabled."; }
  }
  start(): void {
    if (this.timer || this.closed) return;
    const schedule = () => { if (!this.closed) this.timer = setTimeout(() => { void this.tick().finally(schedule); }, 5000); };
    schedule();
  }
  async stop(): Promise<void> { this.closed = true; clearTimeout(this.timer); await Promise.allSettled([this.flight, this.writes]); }
  private save(): void {
    if (this.closed || this.recoveryError) return;
    try { this.store.setSetting(KEY, JSON.stringify(this.routes)); }
    catch {
      this.recoveryError = "Channel routing is disabled because its state could not be saved. Check available disk space before restarting.";
      throw new Error(this.recoveryError);
    }
  }
  private snapshot(turn: Turn): ChannelHarnessJob {
    const run = turn.job.runId ? this.workspace.getRun(turn.job.runId) : undefined;
    return { ...turn.job, ...(run ? { status: run.status, result: run.result, error: turn.job.error ?? run.error } : {}) };
  }
  private async identity(): Promise<{ url: string; author: string; revision: number }> {
    const status = this.relay.status(), revision = this.relay.connectionRevision;
    if (!status.connected || !status.url) throw new Error("Connect a relay identity first.");
    const author = await this.relay.currentIdentity();
    if (revision !== this.relay.connectionRevision) throw new Error("The channel connection changed.");
    return { url: status.url, author, revision };
  }
  async status(channelId: string): Promise<ChannelRouteStatus> {
    if (this.recoveryError) return { error: this.recoveryError, jobs: [] };
    const identity = await this.identity();
    const route = this.routes.find((route) => route.url === identity.url && route.author === identity.author && route.configuration.channelId === channelId);
    return { configuration: route?.configuration, error: route?.error, jobs: route?.turns.slice(-20).reverse().map((turn) => this.snapshot(turn)) ?? [] };
  }
  private removable(route: Route): boolean {
    return !route.turns.some((turn) => turn.phase !== "done" || turn.job.publication === "sharing"
      || this.snapshot(turn).status === "starting" || ACTIVE.has(this.snapshot(turn).status));
  }
  saved(): SavedChannelRoute[] {
    if (this.recoveryError) throw new Error(this.recoveryError);
    return this.routes.map((route) => ({ id: route.id, url: route.url, identity: route.author,
      configuration: { ...route.configuration }, removable: this.removable(route) }));
  }
  remove(id: unknown): Promise<void> {
    if (typeof id !== "string" || !ID.test(id)) return Promise.reject(new Error("Invalid saved route."));
    const write = this.writes.then(() => {
      if (this.closed || this.recoveryError) throw new Error(this.recoveryError ?? "Capsule is shutting down.");
      const route = this.routes.find((item) => item.id === id);
      if (!route) return;
      if (!this.removable(route)) throw new Error("Pause this route and finish or stop its active run before removing it.");
      route.configuration.enabled = false;
      this.routes = this.routes.filter((item) => item !== route);
      this.save();
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  configure(input: unknown): Promise<ChannelRouteStatus> {
    const parsed = config(input);
    const revision = this.relay.connectionRevision;
    const write = this.writes.then(() => {
      if (revision !== this.relay.connectionRevision) throw new Error("The channel connection changed.");
      return this.configureOnce(parsed);
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
  private async configureOnce(input: ChannelRouteInput): Promise<ChannelRouteStatus> {
    if (this.closed || this.recoveryError) throw new Error(this.recoveryError ?? "Capsule is shutting down.");
    const configuration = config(input), identity = await this.identity();
    const previous = this.routes.find((route) => route.url === identity.url && route.author === identity.author && route.configuration.channelId === configuration.channelId);
    if (!configuration.enabled) {
      if (previous) { previous.configuration.enabled = false; this.cancelPending(previous); this.save(); }
      return this.status(configuration.channelId);
    }
    if (!this.workspace.getProject(configuration.projectId)) throw new Error("Choose an existing project.");
    if (previous?.turns.some((turn) => ACTIVE.has(this.snapshot(turn).status) || turn.phase !== "done")) throw new Error("Finish or stop this channel’s active run before changing its harness.");
    if (!previous && this.routes.length >= 16) throw new Error("The saved channel route limit has been reached.");
    const channels = await this.relay.channels();
    if (!channels.some((channel) => channel.id === configuration.channelId && channel.joined)) throw new Error("Join this channel before connecting a harness.");
    const messages = await this.relay.messages(configuration.channelId);
    if (this.closed || identity.revision !== this.relay.connectionRevision) throw new Error("The channel connection changed.");
    const same = previous?.configuration.projectId === configuration.projectId && previous.configuration.harnessId === configuration.harnessId;
    const route: Route = { id: createId("channel-route"), url: identity.url, author: identity.author, configuration, since: Math.floor(Date.now() / 1000),
      seen: messages.map((message) => message.id), turns: same ? previous.turns : [] };
    this.routes = this.routes.filter((item) => item !== previous).concat(route); this.save();
    return this.status(configuration.channelId);
  }
  private cancelPending(route: Route): void {
    for (const turn of route.turns) if (turn.phase !== "done") {
      turn.phase = "done";
      turn.job.error = "Route paused. This reply will not be published automatically. Open the conversation to inspect or stop the run.";
      if (!turn.job.runId) turn.job.status = "cancelled";
    }
  }
  tick(): Promise<void> {
    if (this.closed || this.recoveryError || !this.relay.status().connected) return Promise.resolve();
    return this.flight ??= this.poll().catch((error: unknown) => {
      for (const route of this.routes) if (route.configuration.enabled) route.error = error instanceof Error ? error.message : "Channel connection unavailable.";
      try { this.save(); } catch { this.recoveryError = "Channel routing is disabled because its state could not be saved. Check available disk space before restarting."; }
    }).finally(() => { this.flight = undefined; });
  }
  private async poll(): Promise<void> {
    if (!this.routes.some((route) => route.configuration.enabled)) return;
    const identity = await this.identity();
    const matching = this.routes.filter((route) => route.url === identity.url && route.author === identity.author && route.configuration.enabled);
    if (!matching.length) return;
    const channels = await this.relay.channels();
    for (const route of matching) {
      const valid = () => !this.closed && !this.recoveryError && route.configuration.enabled && this.routes.includes(route) && this.relay.connectionRevision === identity.revision;
      if (!valid()) return;
      try {
        if (!channels.some((channel) => channel.id === route.configuration.channelId && channel.joined)) throw new Error("Channel membership changed. Rejoin and enable the harness again.");
        await this.advance(route, valid);
        if (!valid()) continue;
        const messages = await this.relay.messages(route.configuration.channelId);
        if (!valid()) return;
        if (messages.length >= 100 && messages[0]!.createdAt > route.since) throw new Error("Channel history moved beyond the loaded window. The route is paused to avoid silently skipping work. Review the channel before enabling it again.");
        const now = Math.floor(Date.now() / 1000);
        for (const message of messages) {
          if (message.createdAt > now || message.createdAt < route.since || route.seen.includes(message.id) || route.turns.some((turn) => turn.job.messageId === message.id)) continue;
          route.seen.push(message.id);
          if (message.author !== identity.author || !PREFIX.test(message.content)) continue;
          const prompt = message.content.replace(PREFIX, "").trim();
          if (!prompt) continue;
          if (route.turns.length >= 200) throw new Error("This channel has reached 200 local turns. Pause this route and use a new channel for more work.");
          if (route.turns.filter((turn) => turn.phase !== "done").length >= 10) throw new Error("Too many queued channel turns. The route is paused; review your messages before enabling it again.");
          route.turns.push({ root: message.rootId ?? message.id, prompt, phase: "queued", job: {
            id: createId("channel-run"), messageId: message.id, channelId: route.configuration.channelId,
            projectId: route.configuration.projectId, harnessId: route.configuration.harnessId, status: "queued", publication: "unshared",
          } });
        }
        // Only IDs at the watermark need retention. Older events can never re-enter.
        const watermark = Math.max(route.since, ...messages.filter((message) => message.createdAt <= now).map((message) => message.createdAt));
        route.since = watermark;
        route.seen = messages.filter((message) => message.createdAt >= watermark && route.seen.includes(message.id)).map((message) => message.id);
        this.save();
        await this.advance(route, valid);
      } catch (error) {
        if (!valid()) return;
        route.error = error instanceof Error ? error.message : "Channel routing failed.";
        route.configuration.enabled = false; this.cancelPending(route); this.save();
      }
    }
  }
  private async advance(route: Route, valid: () => boolean): Promise<void> {
    const turn = route.turns.find((turn) => turn.phase !== "done");
    if (!turn || !valid()) return;
    if (turn.phase === "queued") {
      turn.phase = "started"; turn.job.status = "starting"; this.save();
      try {
        const prior = [...route.turns].reverse().find((candidate) => candidate !== turn && candidate.root === turn.root && candidate.job.sessionId);
        const sessionId = prior?.job.sessionId ?? (await this.workspace.createSession({ projectId: turn.job.projectId, agentId: turn.job.harnessId,
          mode: "code", title: `Channel · ${turn.prompt.replace(/\s+/g, " ").slice(0, 60)}`, permissionProfile: "strict", workspaceMode: "local" })).id;
        turn.job.sessionId = sessionId; this.save();
        if (!valid()) return;
        const { run } = await this.workspace.sendMessage({ sessionId, agentId: turn.job.harnessId, mode: "code", content: turn.prompt });
        turn.job.runId = run.id; this.save();
      } catch (error) {
        turn.phase = "done"; turn.job.status = "failed"; turn.job.error = error instanceof Error ? error.message : "The harness could not start.";
        this.save(); throw error;
      }
    }
    if (!valid()) return;
    const state = this.snapshot(turn);
    if (state.status === "starting" || ACTIVE.has(state.status)) return;
    turn.phase = "done"; turn.prompt = "";
    if (state.status !== "completed") { this.save(); throw new Error(state.error ?? `The channel run ${state.status}. Open its conversation for details.`); }
    if (!state.result?.trim() || state.result.length > 15_800) {
      turn.job.error = "No shareable reply: open the conversation to inspect the result or shorten it before sharing.";
      route.error = turn.job.error; route.configuration.enabled = false; this.cancelPending(route);
      this.save(); return;
    }
    turn.job.publication = "sharing"; this.save();
    try {
      await this.relay.post({ channelId: turn.job.channelId, replyTo: turn.root, content: `Capsule · ${turn.job.harnessId}\n\n${state.result.trim()}`, mentions: [] });
      turn.job.publication = "shared";
    } catch {
      turn.job.publication = "uncertain";
      turn.job.error = "Reply delivery is uncertain. Check the thread before posting again; it will not be retried automatically.";
      route.error = turn.job.error; route.configuration.enabled = false; this.cancelPending(route);
    }
    this.save();
  }
}
