import { createId, isHarnessId, type ChannelHarnessInput, type ChannelHarnessJob, type CreateSessionInput, type AgentMessage, type Session, type Run } from "@capsule/shared";
import type { SharedRelayClient } from "@capsule/buzz";

interface Workspace {
  createSession(input: CreateSessionInput): Promise<Session>;
  sendMessage(input: AgentMessage): Promise<{ run: Run }>;
  listRuns(sessionId?: string): Run[];
  getRun(id: string): Run | undefined;
}
interface OwnedJob { job: ChannelHarnessJob; revision: number; replyTo: string }
const ACTIVE = new Set(["starting", "queued", "running", "waiting", "approval_required"]);
const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const MESSAGE_ID = /^[a-f0-9]{64}$/i;

function parse(value: ChannelHarnessInput): ChannelHarnessInput {
  if (!value || typeof value !== "object" || typeof value.channelId !== "string" || !ID.test(value.channelId)
    || typeof value.projectId !== "string" || !ID.test(value.projectId) || typeof value.messageId !== "string"
    || !MESSAGE_ID.test(value.messageId) || (value.rootId !== undefined && (typeof value.rootId !== "string" || !MESSAGE_ID.test(value.rootId))) || !isHarnessId(value.harnessId)) {
    throw new Error("Choose a channel message, project and installed harness.");
  }
  return { ...value, messageId: value.messageId.toLowerCase(), rootId: value.rootId?.toLowerCase() };
}

/** Main owns admission and delivery; the existing workspace owns all execution. */
export class ChannelHarness {
  private readonly jobs = new Map<string, OwnedJob>();
  private readonly admissions = new Map<string, Promise<ChannelHarnessJob>>();
  constructor(private readonly relay: SharedRelayClient, private readonly workspace: Workspace) {}

  private connected(revision: number): void {
    if (!this.relay.status().connected || this.relay.connectionRevision !== revision) throw new Error("The channel connection changed. Open the message again before running or sharing.");
  }
  private snapshot(entry: OwnedJob): ChannelHarnessJob {
    const job = entry.job;
    const run = job.runId ? this.workspace.getRun(job.runId) : job.sessionId ? this.workspace.listRuns(job.sessionId)[0] : undefined;
    return { ...job, ...(run ? { runId: run.id, status: run.status, result: run.result, error: run.error } : {}) };
  }
  list(channelId: string, messageId: string): ChannelHarnessJob[] {
    if (typeof channelId !== "string" || typeof messageId !== "string") throw new Error("Invalid channel message.");
    this.connected(this.relay.connectionRevision);
    return [...this.jobs.values()].filter((entry) => entry.revision === this.relay.connectionRevision && entry.job.channelId === channelId && entry.job.messageId === messageId).map((entry) => this.snapshot(entry));
  }
  start(value: ChannelHarnessInput): Promise<ChannelHarnessJob> {
    const input = parse(value);
    const revision = this.relay.connectionRevision;
    this.connected(revision);
    const key = `${revision}:${input.channelId}:${input.messageId}`;
    const admitted = this.admissions.get(key);
    if (admitted) return admitted;
    const prior = this.list(input.channelId, input.messageId)[0];
    if (prior) return Promise.resolve(prior);
    const pending = this.admit(input, revision).finally(() => this.admissions.delete(key));
    this.admissions.set(key, pending);
    return pending;
  }
  private async admit(input: ChannelHarnessInput, revision: number): Promise<ChannelHarnessJob> {
    const channels = await this.relay.channels();
    if (!channels.some((channel) => channel.id === input.channelId && channel.joined)) throw new Error("Join this channel before running a message.");
    const messages = await this.relay.messages(input.channelId, input.rootId);
    const message = messages.find((item) => item.id === input.messageId);
    if (!message?.content.trim()) throw new Error("This message is no longer in the loaded channel history. Refresh the channel.");
    this.connected(revision);
    if (this.jobs.size >= 100) {
      const removable = [...this.jobs].find(([, entry]) => !ACTIVE.has(this.snapshot(entry).status) && entry.job.publication !== "sharing");
      if (!removable) throw new Error("Too many channel runs are active. Stop one before starting more.");
      this.jobs.delete(removable[0]);
    }
    const entry: OwnedJob = { revision, replyTo: message.rootId ?? message.id, job: {
      id: createId("channel-run"), channelId: input.channelId, messageId: message.id, projectId: input.projectId,
      harnessId: input.harnessId, status: "starting", publication: "unshared",
    } };
    this.jobs.set(entry.job.id, entry);
    void this.launch(entry, message.content);
    return this.snapshot(entry);
  }
  private async launch(entry: OwnedJob, content: string): Promise<void> {
    const job = entry.job;
    try {
      this.connected(entry.revision);
      const session = await this.workspace.createSession({ projectId: job.projectId, agentId: job.harnessId, mode: "code",
        title: `Channel · ${content.replace(/\s+/g, " ").slice(0, 60)}`, permissionProfile: "strict", workspaceMode: "local" });
      job.sessionId = session.id;
      this.connected(entry.revision);
      const { run } = await this.workspace.sendMessage({ sessionId: session.id, agentId: job.harnessId, mode: "code", content });
      job.runId = run.id;
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "The channel run could not start.";
    }
  }
  async share(id: string, content: string): Promise<ChannelHarnessJob> {
    const entry = this.jobs.get(id);
    if (!entry) throw new Error("This channel run is no longer available. Its conversation remains in the project.");
    this.connected(entry.revision);
    const state = this.snapshot(entry);
    if (state.publication === "shared") return state;
    if (state.publication !== "unshared") throw new Error("The reply was already submitted. Check the channel before posting anything else.");
    if (state.status !== "completed") throw new Error("Wait for a successful run before sharing its reply.");
    if (typeof content !== "string" || !content.trim() || content.length > 15_800) throw new Error("The reply must contain between 1 and 15,800 characters. Shorten it before sharing.");
    entry.job.publication = "sharing";
    try {
      await this.relay.post({ channelId: state.channelId, replyTo: entry.replyTo,
        content: `Capsule · ${state.harnessId}\n\n${content.trim()}`, mentions: [] });
      entry.job.publication = "shared";
    } catch {
      entry.job.publication = "uncertain";
      throw new Error("Delivery could not be confirmed. Check the channel before manually posting again; Capsule will not retry automatically.");
    }
    return this.snapshot(entry);
  }
}
