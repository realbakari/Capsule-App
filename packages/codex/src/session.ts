import { EventEmitter } from "node:events";
import path from "node:path";
import type { DirectAcpEvents, DirectAcpOptions, DirectAgentSession } from "@capsule/acp";
import type { AcpModelCatalog, AgentCapabilityReport, AgentPromptBlock, ReportedContextUsage } from "@capsule/shared";
import { readReportedTurnUsage, readPlanEntries } from "@capsule/shared";
import { CodexTransport, object } from "./transport.js";

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const id = (value: unknown) => typeof value === "string" && value.length > 0 && value.length <= 4096 ? value : undefined;
type Turn = { id?: string; resolve(value: { stopReason?: string }): void; reject(error: Error): void; starting: Promise<unknown>; finished: Promise<void>; settle(): void; cancelling: boolean; early: Record<string, unknown>[]; earlyBytes: number };

/** Native app-server client. The installed CLI owns authentication, tools and the agent loop. */
export class DirectCodexSession implements DirectAgentSession {
  private readonly emitter = new EventEmitter();
  private readonly transport: CodexTransport;
  private threadId?: string;
  private catalog: AcpModelCatalog = { availableModels: [] };
  private context?: ReportedContextUsage;
  private turn?: Turn;
  private approvals = new Map<string | number, () => void>();
  private streamed = new Set<string>();
  private filePreviews = new Map<string, string>();
  private selectedModel?: string;
  private closing = false;

  constructor(private readonly options: DirectAcpOptions & { model?: string }) {
    this.selectedModel = options.model;
    this.transport = new CodexTransport(options, (message) => this.receive(message), (error, code) => {
      this.finish(error); this.emitter.emit("exit", { code, stderr: this.closing ? "" : error.message });
    });
  }

  on<K extends keyof DirectAcpEvents>(event: K, handler: DirectAcpEvents[K]): () => void {
    this.emitter.on(event, handler); return () => { this.emitter.off(event, handler); };
  }
  get busy() { return Boolean(this.turn); }
  get running() { return this.transport.running; }
  get sessionId() { return this.threadId; }
  get models() { return this.catalog; }
  get reportedContext() { return this.context; }
  get reportedCommands() { return undefined; }
  get reportedCapabilities(): AgentCapabilityReport {
    return { name: "Codex", images: true, embeddedContext: true, httpMcp: false, resumeSession: true,
      configOptions: this.catalog.availableModels.length ? [{ id: "model", category: "model", name: "Model", currentValue: this.catalog.currentModelId,
        choices: this.catalog.availableModels.map((model) => ({ value: model.modelId, name: model.name })) }] : [] };
  }

  async start(resumeSessionId?: string): Promise<string> {
    this.transport.start();
    try {
      await this.transport.request("initialize", { clientInfo: { name: "capsule", title: "Capsule", version: "0.1.0" } });
      this.transport.send({ method: "initialized", params: {} });
      const models: AcpModelCatalog["availableModels"] = [];
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = object(await this.transport.request("model/list", { limit: 100, ...(cursor ? { cursor } : {}) }));
        for (const candidate of Array.isArray(page.data) ? page.data : []) {
          const row = object(candidate);
          const modelId = id(row.model) ?? id(row.id);
          if (modelId && row.hidden !== true && !models.some((model) => model.modelId === modelId)) models.push({ modelId, name: text(row.displayName)?.slice(0, 128) ?? modelId });
        }
        cursor = id(page.nextCursor);
        if (cursor && cursors.has(cursor)) throw new Error("The agent returned a repeated model catalog page.");
        if (cursor) cursors.add(cursor);
      } while (cursor && cursors.size < 10);
      this.catalog = { availableModels: models };
      if (this.selectedModel && !models.some((model) => model.modelId === this.selectedModel)) throw new Error("The selected model is not reported by this Codex installation. Choose its default model or update the CLI.");
      const result = object(await this.transport.request(resumeSessionId ? "thread/resume" : "thread/start", {
        ...(resumeSessionId ? { threadId: resumeSessionId } : {}), cwd: this.options.cwd ?? process.cwd(),
        // Never inherit a saved session's full-access policy or automatic reviewer.
        approvalPolicy: "untrusted", approvalsReviewer: "user", sandbox: "read-only",
        ...(this.selectedModel ? { model: this.selectedModel } : {}),
      }));
      const threadId = id(object(result.thread).id);
      if (!threadId || (resumeSessionId && threadId !== resumeSessionId)) throw new Error("Codex did not resume the requested conversation. The recorded history is unchanged.");
      if (typeof result.cwd === "string" && path.resolve(result.cwd) !== path.resolve(this.options.cwd ?? process.cwd())) throw new Error("Codex opened a different working folder than requested.");
      const thread = object(result.thread);
      if (thread.ephemeral === true || object(thread.status).type === "active" || object(thread.status).type === "systemError"
        || (Array.isArray(thread.turns) && thread.turns.some((turn) => object(turn).status === "inProgress"))) throw new Error("This saved Codex session is not idle and durable. Resolve its active work in the CLI before resuming here.");
      this.threadId = threadId;
      this.catalog.currentModelId = id(result.model) ?? this.selectedModel;
      this.selectedModel = this.catalog.currentModelId;
      this.emitter.emit("configuration");
      return threadId;
    } catch (error) { await this.close(); throw error; }
  }

  async setConfig(configId: string, value: string | boolean): Promise<void> {
    if (this.busy) throw new Error("Wait for this turn to finish before changing the model.");
    if (configId !== "model" || typeof value !== "string" || !this.catalog.availableModels.some((model) => model.modelId === value)) throw new Error("This model is not reported by the installed agent.");
    this.selectedModel = value; this.catalog.currentModelId = value; this.emitter.emit("configuration");
  }

  async prompt(input: string | AgentPromptBlock[]): Promise<{ stopReason?: string }> {
    if (!this.threadId || !this.running) throw new Error("Start the agent before sending a message.");
    if (this.turn) throw new Error("This agent is already running a turn.");
    const blocks = (typeof input === "string" ? [{ type: "text" as const, text: input }] : input).map((block) => {
      if (block.type === "text") return { type: "text", text: block.text, text_elements: [] };
      if (block.type === "image") return { type: "image", url: `data:${block.mimeType};base64,${block.data}` };
      if ("text" in block.resource) return { type: "text", text: `${block.resource.uri}\n${block.resource.text}`, text_elements: [] };
      throw new Error("This agent cannot accept a binary resource. Attach an image or text file instead.");
    });
    this.streamed.clear();
    return new Promise((resolve, reject) => {
      let settle!: () => void;
      const finished = new Promise<void>((resolve) => { settle = resolve; });
      const turn: Turn = { resolve, reject, cancelling: false, starting: Promise.resolve(), finished, settle, early: [], earlyBytes: 0 };
      this.turn = turn;
      turn.starting = this.transport.request("turn/start", { threadId: this.threadId, input: blocks, ...(this.selectedModel ? { model: this.selectedModel } : {}) });
      void turn.starting.then((value) => {
        if (this.turn !== turn) return;
        const turnId = id(object(object(value).turn).id);
        if (!turnId || (turn.id && turn.id !== turnId)) { this.finish(new Error("Codex returned an inconsistent turn identity.")); void this.close().catch(() => undefined); }
        else {
          turn.id = turnId;
          const early = turn.early.splice(0); turn.earlyBytes = 0;
          for (const message of early) this.receive(message);
        }
      }).catch((error: unknown) => { if (this.turn === turn) this.finish(error instanceof Error ? error : new Error(String(error))); });
    });
  }

  async cancel(): Promise<void> {
    const turn = this.turn;
    if (!turn || turn.cancelling) return;
    turn.cancelling = true;
    try {
      await turn.starting;
      if (this.turn !== turn) return;
      if (!turn.id) throw new Error("The agent has not identified its current turn.");
      await this.transport.request("turn/interrupt", { threadId: this.threadId, turnId: turn.id });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([turn.finished, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Codex did not confirm the interrupted turn. The connection was closed before another turn could start.")), this.options.timeoutMs ?? 5000);
        })]);
      } finally { clearTimeout(timer); }
    } catch (error) { await this.close(); throw error; }
  }

  close(): Promise<void> { this.closing = true; return this.transport.close(); }

  private finish(error?: Error, stopReason = "end_turn"): void {
    const turn = this.turn; this.turn = undefined;
    for (const settle of this.approvals.values()) settle();
    this.approvals.clear(); this.streamed.clear(); this.filePreviews.clear();
    if (!turn) return;
    turn.settle();
    if (error) turn.reject(error);
    else { this.emitter.emit("done", { stopReason }); turn.resolve({ stopReason }); }
  }

  private receive(message: Record<string, unknown>): void {
    const method = text(message.method);
    const params = object(message.params);
    if (this.turn && !this.turn.id && params.threadId === this.threadId) {
      this.turn.earlyBytes += Buffer.byteLength(JSON.stringify(message));
      if (this.turn.early.length >= 256 || this.turn.earlyBytes > 4 * 1024 * 1024) {
        this.finish(new Error("The agent sent too much activity before acknowledging the turn.")); void this.close().catch(() => undefined); return;
      }
      this.turn.early.push(message); return;
    }
    if (typeof message.id === "number" || typeof message.id === "string") {
      this.serverRequest(message.id, method, params); return;
    }
    if (params.threadId !== this.threadId || !this.turn) return;
    if (method === "serverRequest/resolved") {
      const requestId = params.requestId;
      if (typeof requestId === "number" || typeof requestId === "string") { this.approvals.get(requestId)?.(); this.approvals.delete(requestId); }
      return;
    }
    const turnId = id(params.turnId) ?? id(object(params.turn).id);
    if (turnId && this.turn.id && turnId !== this.turn.id) return;
    if (method === "item/agentMessage/delta" || method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      if (typeof params.delta !== "string") return;
      const itemId = id(params.itemId);
      if (itemId && this.streamed.size < 4096) this.streamed.add(itemId);
      this.emitter.emit("text", { text: params.delta, thought: method !== "item/agentMessage/delta" });
    } else if (method === "item/started" || method === "item/completed") {
      const item = object(params.item); const itemId = id(item.id); const completed = method === "item/completed";
      if (item.type === "fileChange" && itemId && this.filePreviews.size < 256) this.filePreviews.set(itemId, JSON.stringify(item.changes ?? []).slice(0, 8001));
      if (item.type === "agentMessage" && completed) {
        if (itemId && !this.streamed.has(itemId) && typeof item.text === "string") this.emitter.emit("text", { text: item.text, thought: false });
        this.emitter.emit("message-end");
      } else if (typeof item.type === "string" && !["userMessage", "reasoning", "agentMessage"].includes(item.type)) {
        this.emitter.emit("tool", { toolCallId: itemId, kind: item.type === "commandExecution" ? "execute" : item.type === "fileChange" ? "edit" : item.type === "webSearch" ? "search" : "other", title: (text(item.command) ?? text(item.tool) ?? item.type).slice(0, 512),
          status: completed ? (item.status === "failed" || item.status === "declined" ? "failed" : "completed") : "in_progress",
          details: typeof item.aggregatedOutput === "string" ? { output: item.aggregatedOutput.slice(-16000) } : undefined });
      }
    } else if (method === "turn/plan/updated" && Array.isArray(params.plan)) {
      const entries = readPlanEntries(params.plan.slice(0, 32).map((entry) => ({ content: object(entry).step, status: object(entry).status })));
      if (entries) this.emitter.emit("plan", { entries });
    } else if (method === "thread/tokenUsage/updated") {
      const usage = object(params.tokenUsage); const last = object(usage.last);
      if (typeof last.totalTokens === "number" && Number.isSafeInteger(last.totalTokens) && last.totalTokens >= 0 && typeof usage.modelContextWindow === "number" && Number.isSafeInteger(usage.modelContextWindow) && usage.modelContextWindow > 0) this.context = { source: "agent", used: last.totalTokens, size: usage.modelContextWindow };
      const turn = readReportedTurnUsage({ ...last, cachedReadTokens: last.cachedInputTokens, cachedWriteTokens: last.cacheWriteInputTokens, thoughtTokens: last.reasoningOutputTokens });
      this.emitter.emit("usage", { context: this.context, turn });
    } else if (method === "turn/completed") {
      const turn = object(params.turn);
      if (turn.status === "failed") this.finish(new Error(text(object(turn.error).message) ?? "The agent turn failed."));
      else if (turn.status === "interrupted") this.finish(undefined, "cancelled");
      else if (turn.status === "completed") this.finish();
      else this.finish(new Error("The agent returned an unknown completion status."));
    }
  }

  private serverRequest(requestId: string | number, method: string | undefined, params: Record<string, unknown>): void {
    const approval = method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval";
    if (!approval) {
      this.transport.send({ id: requestId, error: { code: -32601, message: "This client does not support this interactive request." } });
      if (params.threadId === this.threadId && this.turn) {
        this.finish(new Error("The agent requested an unsupported interaction. Continue this task in its CLI.")); void this.close().catch(() => undefined);
      }
      return;
    }
    if (!this.turn || params.threadId !== this.threadId || (this.turn.id && params.turnId !== this.turn.id)) {
      this.transport.send({ id: requestId, result: { decision: "cancel" } }); return;
    }
    if (this.approvals.size >= 64) { this.transport.send({ id: requestId, result: { decision: "cancel" } }); return; }
    let settle!: () => void;
    let answered = false;
    const settled = new Promise<void>((resolve) => { settle = () => { answered = true; resolve(); }; });
    const answer = (decision: "accept" | "decline" | "cancel") => {
      if (answered) return;
      settle(); this.approvals.delete(requestId); this.transport.send({ id: requestId, result: { decision } });
    };
    this.approvals.set(requestId, settle);
    if (!this.emitter.listenerCount("permission")) { answer("cancel"); return; }
    const canApproveOnce = !Array.isArray(params.availableDecisions) || params.availableDecisions.includes("accept");
    const itemId = id(params.itemId);
    const preview = [text(params.command), text(params.reason), text(params.grantRoot), itemId ? this.filePreviews.get(itemId) : undefined,
      params.networkApprovalContext ? JSON.stringify(params.networkApprovalContext) : undefined].filter(Boolean).join("\n");
    this.emitter.emit("permission", { title: method === "item/fileChange/requestApproval" ? "Allow proposed file changes?" : "Allow this command?", canApproveOnce, settled,
      details: { toolCallId: id(params.itemId), kind: method === "item/fileChange/requestApproval" ? "edit" : "execute", locations: typeof params.cwd === "string" ? [params.cwd] : [], preview: preview.slice(0, 8000), truncated: preview.length > 8000, canApproveOnce },
      allow: () => answer(canApproveOnce ? "accept" : "decline"), deny: () => answer("decline"), cancel: () => answer("cancel") });
  }
}
