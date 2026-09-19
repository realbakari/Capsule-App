import { EventEmitter } from "node:events";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { checkServedFingerprint, type Connection } from "@muse-code/sdk";
import type { DirectAcpEvents, DirectAcpOptions, DirectAgentSession } from "@capsule/acp";
import { readReportedTurnUsage, type AgentCapabilityReport, type AgentPromptBlock, type AcpModelCatalog } from "@capsule/shared";
import { approvalChoices, identifier, label, museInput, object, readModels, type MuseModel } from "./protocol.js";
import { openMuseTransport } from "./transport.js";

interface Item { kind: string; text: string; revision: number; ended: boolean }
interface Turn {
  commandId: string;
  id?: string;
  items: Map<string, Item>;
  cursors: Set<string>;
  bytes: number;
  settled: boolean;
  early: Array<{ method: string; params: Record<string, unknown> }>;
  earlyBytes: number;
  resolve(value: { stopReason?: string }): void;
  reject(error: Error): void;
}

/**
 * One native Muse conversation. Muse owns tools, policy and credentials.
 * Capsule stores the transcript; this adapter retains only a bounded active
 * turn projection, never the SDK's cumulative session history or replay cache.
 */
export class DirectMuseSession implements DirectAgentSession {
  private readonly emitter = new EventEmitter();
  private transport?: ReturnType<typeof openMuseTransport>;
  private id?: string;
  private closed = false;
  private closing?: Promise<void>;
  private cancelling?: Promise<void>;
  private failure?: Error;
  private turn?: Turn;
  private setting = false;
  private catalogue?: AcpModelCatalog;
  private modelRows: MuseModel[] = [];
  private readonly approvals = new Map<string, { stage: string; params: Record<string, unknown>; cancel(): void }>();
  private readonly decidedRequirements = new Set<string>();
  private report: AgentCapabilityReport = {
    name: "Muse Code", images: true, embeddedContext: false, httpMcp: false,
    loadSession: false, resumeSession: false, closeSession: false, configOptions: [],
  };
  readonly reportedContext = undefined;
  readonly reportedCommands = undefined;
  get busy() { return Boolean(this.turn); }
  get running() { return Boolean(this.transport) && !this.closed; }
  get sessionId() { return this.id; }
  get models() { return this.catalogue; }
  get reportedCapabilities() { return this.report; }

  constructor(private readonly options: DirectAcpOptions & { model?: string }) {}
  on<K extends keyof DirectAcpEvents>(event: K, handler: DirectAcpEvents[K]): () => void {
    this.emitter.on(event, handler);
    return () => this.emitter.off(event, handler);
  }

  async start(resumeSessionId?: string): Promise<string> {
    if (this.transport || this.closed) throw new Error("This Muse transport cannot be started twice.");
    this.transport = openMuseTransport(this.options, (error, code) => {
      this.fail(error);
      this.emitter.emit("exit", { code, stderr: "" });
    });
    const connection = this.transport.connection;
    connection.onNotification(({ method, params }) => this.notification(method, object(params)));
    connection.onServerRequest(async ({ method, params }) => {
      // These requests are wake-up hints; the decision is a separate command.
      if (method === "approval/request") this.permission(object(params));
      else if (method === "userInput/request") this.unsupportedQuestion(object(params));
      else throw new Error("Unsupported Muse client request.");
      return {};
    });
    connection.onProtocolError(() => this.fail(new Error("Muse sent an invalid or oversized protocol message. Restart the session.")));
    void connection.closed.then(() => {
      if (!this.closed) this.fail(new Error("The Muse connection ended before the session finished."));
    });
    try {
      const initialized = await this.request("initialize", {
        clientInfo: { name: "capsule", title: "Capsule", version: "1" },
        capabilities: { userInputDialogs: false },
      });
      const schema = object(initialized.schema);
      if (schema.version !== 1 || !identifier(schema.fingerprint)) throw new Error("This Muse protocol version is not supported.");
      if (checkServedFingerprint(String(schema.fingerprint))) {
        // MSP explicitly permits additive schema evolution.
        console.warn("Muse reported a different session schema; Capsule will use the supported fields.");
      }
      this.report.version = label(object(initialized.serverInfo).version, "unknown");
      this.report.resumeSession = initialized.sessionDurability === undefined || initialized.sessionDurability === "durable";
      if (resumeSessionId && !this.report.resumeSession) throw new Error("This Muse build cannot resume durable sessions. Start a new conversation.");
      connection.notify("initialized");
      const result = resumeSessionId
        ? await this.command("session/resume", { sessionId: resumeSessionId, excludeItems: true })
        : await this.command("session/start", {
          workspaceRoot: path.resolve(this.options.cwd ?? process.cwd()), approvalMode: "promptUnmatched",
          ...(this.options.model ? { modelId: this.options.model } : {}),
        });
      const session = object(result.session);
      if (object(result.history).noneReason === "projectionUnavailable") throw new Error("Muse cannot provide this session's activity. Retry after its session projection recovers.");
      const id = identifier(session.sessionId);
      if (!id || (resumeSessionId && id !== resumeSessionId)) throw new Error("Muse returned a different session identity.");
      const expectedRoot = await realpath(this.options.cwd ?? process.cwd());
      const reportedRoot = typeof session.workspaceRoot === "string" && path.isAbsolute(session.workspaceRoot)
        ? await realpath(session.workspaceRoot).catch(() => undefined) : undefined;
      if (reportedRoot !== expectedRoot) {
        throw new Error("The Muse session belongs to a different workspace. Capsule will not resume it here.");
      }
      if (session.status !== "idle" || session.activeTurnId != null || (Array.isArray(result.pendingRequests) && result.pendingRequests.length)) {
        throw new Error("This Muse session has unfinished work. Resolve it in the Muse CLI before resuming it here.");
      }
      this.id = id;
      const models = readModels(await this.request("model/list", { sessionId: id }));
      this.modelRows = models.models;
      this.catalogue = { ...models.catalog, currentModelId: identifier(session.modelId) ?? models.catalog.currentModelId };
      this.refreshConfiguration();
      return id;
    } catch (error) {
      await this.close();
      throw this.failure ?? error;
    }
  }

  async prompt(prompt: string | AgentPromptBlock[]): Promise<{ stopReason?: string }> {
    if (!this.running || !this.id) throw new Error("Muse is not connected.");
    if (this.busy || this.setting) throw new Error("Wait for Muse's active operation before sending again.");
    const input = museInput(prompt);
    const commandId = this.connection.mintCommandId();
    let resolve!: Turn["resolve"];
    let reject!: Turn["reject"];
    const completed = new Promise<{ stopReason?: string }>((ok, fail) => { resolve = ok; reject = fail; });
    void completed.catch(() => {});
    const turn: Turn = { commandId, items: new Map(), cursors: new Set(), bytes: 0, settled: false, early: [], earlyBytes: 0, resolve, reject };
    this.turn = turn;
    try {
      const ack = await this.command("turn/start", { sessionId: this.id, input }, commandId);
      const id = identifier(ack.turnId);
      if (!id || (turn.id && id !== turn.id) || ack.disposition !== "started") {
        throw new Error("Muse did not start this turn immediately. Reopen the session to inspect its state.");
      }
      turn.id = id;
      this.flushEarly(turn);
      return await completed;
    } catch (error) {
      // A lost admission ack must not let the next prompt enter an uncertain turn.
      await this.close();
      throw this.failure ?? error;
    } finally {
      if (this.turn === turn) this.turn = undefined;
      this.clearApprovals();
    }
  }

  cancel(): Promise<void> {
    // Stop and a pending permission's cancellation can reach us together.
    // One interrupt owns the acknowledgement and terminal-event wait.
    return this.cancelling ??= this.cancelTurn().finally(() => { this.cancelling = undefined; });
  }

  private async cancelTurn(): Promise<void> {
    const turn = this.turn;
    if (!turn) return;
    if (!turn.id) { await this.close(); return; }
    await this.command("turn/interrupt", { sessionId: this.id, turnId: turn.id, retract: false });
    if (this.turn === turn && !turn.settled) {
      let done!: () => void;
      try {
        await this.deadline(new Promise<void>((resolve) => {
          done = resolve;
          this.emitter.once("done", done);
          if (turn.settled) resolve();
        }));
      } finally { this.emitter.off("done", done); }
    }
  }

  async setConfig(id: string, value: string | boolean): Promise<void> {
    if (!this.running || this.busy || this.setting) throw new Error("Wait for Muse to finish before changing its settings.");
    const selected = this.modelRows.find((model) => model.modelId === value);
    if (id !== "model" || !selected) throw new Error("Choose a model reported by this Muse session.");
    this.setting = true;
    try {
      await this.command("session/setModel", { sessionId: this.id, model: {
        modelId: selected.modelId, providerId: selected.providerId, profileId: selected.profileId,
      } });
      const result = readModels(await this.request("model/list", { sessionId: this.id }));
      this.modelRows = result.models;
      this.catalogue = result.catalog;
      this.refreshConfiguration();
    } finally { this.setting = false; }
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      this.finish(undefined, new Error("Muse session closed."));
      this.clearApprovals();
      await this.transport?.close();
    })();
    return this.closing;
  }

  private get connection(): Connection {
    if (!this.transport) throw new Error("Muse is not connected.");
    return this.transport.connection;
  }

  private async deadline<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Muse did not answer in time. Restart the session before trying again."));
          this.requestClose();
        }, this.options.timeoutMs ?? 30_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  private request(method: string, params: Record<string, unknown>) {
    return this.deadline(this.connection.request(method, params));
  }

  private async command(method: string, params: Record<string, unknown>, commandId = this.connection.mintCommandId()) {
    // SDK-minted IDs without its unbounded command replay cache, which would
    // otherwise retain all submitted prompts and base64 images. Never retry
    // uncertain writes automatically.
    const ack = await this.request(method, { ...params, commandId });
    if (ack.commandId !== undefined && ack.commandId !== commandId) throw new Error("Muse acknowledged a different command.");
    if (ack.status !== undefined && ack.status !== "accepted") throw new Error("Muse did not accept the command.");
    return ack;
  }

  private refreshConfiguration() {
    this.report.configOptions = this.catalogue?.availableModels.length ? [{
      id: "model", category: "model", name: "Model", currentValue: this.catalogue.currentModelId,
      choices: this.catalogue.availableModels.map((model) => ({ value: model.modelId, name: model.name })),
    }] : [];
    this.emitter.emit("configuration");
  }

  private notification(method: string, params: Record<string, unknown>) {
    if (!this.id || params.sessionId !== this.id || this.closed) return;
    if (method === "session/modelChanged" && this.catalogue) {
      this.catalogue.currentModelId = identifier(params.modelId);
      this.refreshConfiguration();
      return;
    }
    if (method === "view/gap" || (method === "session/viewHealthChanged" && params.health === "unavailable")) {
      this.fail(new Error("Muse reported missing activity. The turn cannot be verified; reopen the session before continuing."));
      return;
    }
    if (method === "approval/resolved") {
      const id = identifier(params.approvalId);
      if (id) { this.approvals.get(id)?.cancel(); this.approvals.delete(id); }
      return;
    }
    const turn = this.turn;
    if (!turn || turn.settled) return;
    if (method === "turn/started" && params.commandId === turn.commandId) {
      turn.id = identifier(params.turnId);
      this.flushEarly(turn);
    }
    if (!turn.id) {
      turn.earlyBytes += Buffer.byteLength(JSON.stringify(params), "utf8");
      if (turn.early.length >= 256 || turn.earlyBytes > 1024 * 1024) {
        this.fail(new Error("Muse sent too much activity before acknowledging the turn."));
      } else turn.early.push({ method, params });
      return;
    }
    const item = object(params.item);
    const itemId = identifier(item.itemId ?? params.itemId);
    if ((params.turnId ?? item.turnId ?? turn.id) !== turn.id) return;
    const cursor = identifier(params.viewCursor);
    if (cursor && turn.cursors.has(cursor)) return;
    if (cursor) turn.cursors.add(cursor);
    if (turn.cursors.size > 32_768 || turn.items.size > 2048) {
      this.fail(new Error("Muse exceeded the live activity budget. Start a new turn to continue."));
      return;
    }
    if (method === "turn/completed") {
      const usage = object(params.usage);
      const report = readReportedTurnUsage({ ...usage, cachedReadTokens: usage.cachedTokens, thoughtTokens: usage.reasoningTokens });
      if (report) this.emitter.emit("usage", { turn: report });
      if (params.terminal === "completed") this.finish("end_turn");
      else if (params.terminal === "cancelled") this.finish("cancelled");
      else this.finish(undefined, new Error(params.terminal === "failed" ? "Muse reported that the turn failed. Check its CLI diagnostics before retrying." : "Muse returned an unknown turn outcome."));
    } else if (method === "approval/requested" || method === "approval/updated") this.permission(params);
    else if (method === "userInput/requested") this.unsupportedQuestion(params);
    else if (itemId && method === "item/delta") {
      const previous = turn.items.get(itemId);
      if (previous && !previous.ended && (previous.kind === "agentMessage" || previous.kind === "reasoning")
        && (params.field === undefined || params.field === "text") && typeof params.delta === "string") {
        this.appendText(previous, params.delta, turn);
      }
    } else if (itemId && ["item/started", "item/updated", "item/completed"].includes(method)) {
      this.projectItem(turn, itemId, item, method === "item/completed");
    }
  }

  private flushEarly(turn: Turn) {
    const early = turn.early.splice(0);
    turn.earlyBytes = 0;
    for (const event of early) this.notification(event.method, event.params);
  }

  private projectItem(turn: Turn, itemId: string, item: Record<string, unknown>, completed: boolean) {
    if (item.turnId !== turn.id) return;
    const previous = turn.items.get(itemId);
    const revision = typeof item.revision === "number" ? item.revision : 0;
    if (previous && revision <= previous.revision) return;
    const state = previous ?? { kind: String(item.kind), revision: 0, text: "", ended: false };
    state.revision = revision;
    turn.items.set(itemId, state);
    if (state.kind === "agentMessage" || state.kind === "reasoning") {
      const snapshot = typeof item.text === "string" ? item.text : "";
      if (!snapshot.startsWith(state.text)) {
        this.fail(new Error("Muse revised text that was already displayed. Reopen the session to avoid an inconsistent reply."));
        return;
      }
      this.appendText(state, snapshot.slice(state.text.length), turn);
      if (completed && !state.ended && state.kind === "agentMessage") this.emitter.emit("message-end");
    } else if (state.kind !== "userMessage") {
      this.emitter.emit("tool", {
        title: label(item.tool ?? item.fallbackText ?? item.objective, label(item.kind, "Muse activity")),
        kind: state.kind === "toolCall" ? "tool" : state.kind,
        status: item.status === "inProgress" ? "running" : item.status === "completed" ? "completed" : "failed",
        toolCallId: identifier(item.callId) ?? itemId,
      });
    }
    state.ended = item.status !== "inProgress";
  }

  private appendText(item: Item, text: string, turn: Turn) {
    if (!text) return;
    turn.bytes += Buffer.byteLength(text, "utf8");
    if (turn.bytes > 4 * 1024 * 1024) {
      this.fail(new Error("Muse exceeded the live text budget. Start a new turn to continue."));
      return;
    }
    item.text += text;
    this.emitter.emit("text", { text, thought: item.kind === "reasoning" });
  }

  private permission(params: Record<string, unknown>) {
    const previousId = identifier(params.approvalId);
    const previous = previousId ? this.approvals.get(previousId) : undefined;
    // Updated approvals carry new choices and a requirement token, not the
    // original tool/turn envelope. Never infer ownership for an unknown ID.
    if (previous && params.turnId === undefined) params = { ...previous.params, ...params };
    if (!this.id || params.sessionId !== this.id || !this.turn || this.turn.settled || params.turnId !== this.turn.id) return;
    const id = identifier(params.approvalId);
    const requirement = object(params.currentRequirementId);
    if (!id || requirement.approvalId !== id || !Number.isSafeInteger(requirement.sourceIndex) || Number(requirement.sourceIndex) < 0) {
      this.fail(new Error("Muse sent an invalid approval request."));
      return;
    }
    const stage = JSON.stringify([requirement, params.availableChoices, params.subject]);
    const requirementKey = JSON.stringify([id, requirement.sourceIndex]);
    if (this.decidedRequirements.has(requirementKey)) return;
    if (this.approvals.get(id)?.stage === stage) return;
    this.approvals.get(id)?.cancel();
    if (this.approvals.size >= 16) { this.fail(new Error("Muse requested too many simultaneous approvals.")); return; }
    const choices = approvalChoices(params.availableChoices);
    let active = true;
    let resolveSettled!: () => void;
    const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
    const cancel = () => { active = false; resolveSettled(); };
    this.approvals.set(id, { stage, params, cancel });
    const decide = (choiceId: string | undefined) => {
      if (!active || this.closed) return;
      active = false;
      resolveSettled();
      if (!choiceId) { void this.cancel().catch(() => this.requestClose()); return; }
      // Choice-list refreshes may arrive after a decision. They must never
      // reopen the same requirement or issue a second permission command.
      if (this.decidedRequirements.size >= 2048) {
        this.fail(new Error("Muse exceeded the per-turn approval budget."));
        return;
      }
      this.decidedRequirements.add(requirementKey);
      void this.command("approval/decide", { sessionId: this.id, approvalId: id, requirementId: requirement, choiceId })
        .catch(() => this.fail(new Error("Muse could not apply the approval. The turn was stopped to avoid an uncertain permission state.")));
    };
    const subject = object(params.subject);
    const preview = typeof subject.command === "string" ? subject.command : params.rawArgs;
    const request = {
      settled,
      title: label(params.toolName, "Muse tool"), canApproveOnce: Boolean(choices.allow),
      details: {
        toolCallId: identifier(params.toolCallId), kind: label(subject.kind, "tool"),
        locations: typeof subject.path === "string" ? [label(subject.path, "Workspace file")] : [],
        preview: label(preview, "Muse requested a tool action."),
        truncated: typeof preview === "string" && preview.length > 200,
        canApproveOnce: Boolean(choices.allow),
      },
      allow: () => decide(choices.allow), deny: () => decide(choices.deny),
      cancel: () => { if (active) { active = false; void this.cancel().catch(() => this.requestClose()); } },
    };
    if (!this.emitter.emit("permission", request)) request.cancel();
  }

  private unsupportedQuestion(params: Record<string, unknown>) {
    if (params.sessionId !== this.id || !this.turn || params.turnId !== this.turn.id) return;
    const id = identifier(params.userInputId);
    if (!id) return;
    void this.command("userInput/cancel", { sessionId: this.id, userInputId: id, reason: "Answer questions in a follow-up message in Capsule." })
      .then(() => this.fail(new Error("Muse requested an interactive questionnaire. Answer it in a follow-up message; questionnaire forms are not supported here yet.")))
      .catch(() => this.fail(new Error("Muse's interactive question could not be dismissed. Reopen the session.")));
  }

  private clearApprovals() {
    for (const approval of this.approvals.values()) approval.cancel();
    this.approvals.clear();
    this.decidedRequirements.clear();
  }
  private finish(stopReason?: string, error?: Error) {
    const turn = this.turn;
    if (!turn || turn.settled) return;
    turn.settled = true;
    this.clearApprovals();
    if (error) turn.reject(error);
    else turn.resolve({ stopReason });
    this.emitter.emit("done", { stopReason });
  }
  private fail(error: Error) {
    if (!this.closed) this.failure = error;
    this.finish(undefined, error);
    this.requestClose();
  }
  private requestClose() {
    // Event callbacks cannot await teardown. Public close() retains the
    // rejected promise so the owning host can also report an exit failure.
    void this.close().catch(() => {
      this.emitter.emit("exit", { code: null, stderr: "Muse process cleanup could not be confirmed." });
    });
  }
}
