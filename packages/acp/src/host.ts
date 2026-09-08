import { EventEmitter } from "node:events";
import path from "node:path";

import {
  PRESET_HARNESSES,
  parseAcpStatus,
  type HarnessId,
  type HarnessOptionKey,
  type Unsubscribe,
  type DirectSessionIdentity,
  type AgentPromptBlock,
} from "@capsule/shared";

import { explainDirectFailure, readCliError } from "./errors.js";
import { DirectAcpSession, type AcpMcpServer, type DirectAcpEvents } from "./session.js";

export type DirectActivity =
  | { type: "configuration"; sessionKey: string }
  | { type: "usage"; sessionKey: string; usage: Parameters<DirectAcpEvents["usage"]>[0] }
  | { type: "tool"; sessionKey: string; tool: Parameters<DirectAcpEvents["tool"]>[0] }
  | { type: "permission"; sessionKey: string; request: Parameters<DirectAcpEvents["permission"]>[0] };

/*
 * Direct mode.
 *
 * The Gateway route asks OpenClaw to spawn a CLI through acpx and relays the
 * conversation. This one spawns the CLI itself. It answers the same calls the
 * engine already makes for a coding turn and emits the same replies, so the
 * turn pipeline above it does not know or care which route carried it.
 *
 * It can only drive an agent that speaks ACP on its own — a preset with an
 * `acpxCommand`. That is a real limit, not an oversight: Claude Code and Codex
 * have no ACP mode of their own today and reach it through an adapter that
 * OpenClaw supplies, so they stay on the Gateway route.
 */

export interface DirectSpawnInput {
  /** Capsule thread identity, not the native agent's ACP session id. */
  threadId?: string;
  harnessId: HarnessId;
  cwd?: string;
  title?: string;
  prompt?: string;
  sessionKey?: string;
  model?: string;
  resume?: DirectSessionIdentity;
}

export type DirectMcpOffer = AcpMcpServer[] | ((input: DirectSpawnInput) => {
  servers: AcpMcpServer[];
  dispose(): void;
});

export interface AcpReply {
  sessionKey?: string;
  text?: string;
  /** The current message ended. Run completion is carried separately. */
  done?: boolean;
  control?: boolean;
}

/** The key a direct session is known by, so it cannot be mistaken for a Gateway one. */
export function directSessionKey(harnessId: string, id: string): string {
  return `direct:acp:${harnessId}:${id}`;
}

export function isDirectSessionKey(key: string | undefined): boolean {
  return Boolean(key?.startsWith("direct:acp:"));
}

/** Whether this harness can be driven without the Gateway. */
export function supportsDirectMode(harnessId: string): boolean {
  return Boolean(PRESET_HARNESSES.find((preset) => preset.id === harnessId)?.acpxCommand);
}

/** The harnesses direct mode can drive, for a settings screen to name them. */
export function directCapableHarnesses(): HarnessId[] {
  return PRESET_HARNESSES.filter((preset) => preset.acpxCommand).map((preset) => preset.id);
}

export class DirectAcpHost {
  /*
   * MCP servers offered to every agent this host spawns. Set by the
   * application once its servers are listening, because the URL has to exist
   * before an agent can be told about it.
   */
  private mcpServers: DirectMcpOffer = [];
  private mcpDisposers = new Map<string, () => void>();

  /** Replaces the set offered to agents started from now on. */
  offerMcpServers(servers: DirectMcpOffer): void {
    this.mcpServers = servers;
  }

  readonly kind = "direct" as const;

  private readonly emitter = new EventEmitter();
  private readonly sessions = new Map<string, DirectAcpSession>();
  private readonly harnessBySession = new Map<string, HarnessId>();
  private counter = 0;

  isRunning(key: string): boolean { return this.sessions.get(key)?.running === true; }
  capabilities(key: string) { return this.sessions.get(key)?.reportedCapabilities; }

  onAcpReply(handler: (payload: AcpReply) => void): Unsubscribe {
    this.emitter.on("acp-reply", handler);
    return () => this.emitter.off("acp-reply", handler);
  }

  onActivity(handler: (payload: DirectActivity) => void): Unsubscribe {
    this.emitter.on("activity", handler);
    return () => this.emitter.off("activity", handler);
  }

  /** What a user would run to get the same thing in a terminal. */
  acpCommandFor(harnessId: HarnessId): string {
    const preset = PRESET_HARNESSES.find((item) => item.id === harnessId);
    if (!preset?.acpxCommand) return "";
    return [preset.acpxCommand.command, ...(preset.acpxCommand.args ?? [])].join(" ");
  }

  async spawnAcpSession(
    input: DirectSpawnInput,
  ): Promise<{ sessionKey: string; usedSlashCommand: boolean; command: string; directSession?: DirectSessionIdentity }> {
    const preset = PRESET_HARNESSES.find((item) => item.id === input.harnessId);
    if (!preset?.acpxCommand) {
      throw new Error(
        `${preset?.name ?? input.harnessId} has no ACP mode of its own, so direct mode cannot drive it. Switch this thread to the OpenClaw Gateway, or pick an agent that does.`,
      );
    }

    // A key that is still live is the session; re-spawning would strand it.
    if (input.sessionKey && this.sessions.get(input.sessionKey)?.running) {
      if (this.harnessBySession.get(input.sessionKey) !== input.harnessId) throw new Error("This running session belongs to another harness. Close it before switching agents.");
      return {
        sessionKey: input.sessionKey,
        usedSlashCommand: false,
        command: this.acpCommandFor(input.harnessId),
      };
    }

    const args = [...(preset.acpxCommand.args ?? [])];
    const cwd = path.resolve(input.cwd ?? process.cwd());
    const launchSignature = JSON.stringify(preset.acpxCommand);
    if (input.resume && (typeof input.resume.sessionId !== "string" || !input.resume.sessionId.trim() || input.resume.sessionId.length > 4096)) {
      throw new Error("The saved agent session identity is invalid. Start a new conversation; Capsule will not silently replace its history.");
    }
    if (input.resume && (input.resume.harnessId !== input.harnessId || input.resume.cwd !== cwd || input.resume.launchSignature !== launchSignature)) {
      throw new Error("The saved agent session belongs to a different harness, working folder or launch command. Start a new conversation; Capsule will not resume it in another workspace.");
    }
    // A model asked for at spawn time wins over the preset's own choice.
    if (input.model && !input.resume) {
      const flag = args.indexOf("--model");
      if (flag >= 0) args[flag + 1] = input.model;
      else args.push("--model", input.model);
    }

    /*
     * Whatever the host wants this agent to be able to reach. Capsule passes
     * its browser tools here; an empty list is the old behaviour.
     */
    const offer = typeof this.mcpServers === "function" ? this.mcpServers(input) : { servers: this.mcpServers, dispose: () => {} };
    const session = new DirectAcpSession({
      command: preset.acpxCommand.command,
      args,
      cwd,
      ...(offer.servers.length > 0 ? { mcpServers: offer.servers } : {}),
    });

    const key = directSessionKey(input.harnessId, `${Date.now().toString(36)}${this.counter++}`);
    this.mcpDisposers.set(key, offer.dispose);
    this.wire(key, session);
    try { await session.start(input.resume?.sessionId); } catch (error) { offer.dispose(); this.mcpDisposers.delete(key); await session.close(); throw error; }
    this.sessions.set(key, session);
    this.harnessBySession.set(key, input.harnessId);

    if (input.prompt) void this.send(key, input.prompt);
    return {
      sessionKey: key,
      usedSlashCommand: false,
      command: [preset.acpxCommand.command, ...args].join(" "),
      directSession: { sessionId: session.sessionId!, harnessId: input.harnessId, cwd, launchSignature },
    };
  }

  /** Send a turn. The reply arrives through `onAcpReply`, as the Gateway's does. */
  /*
   * Returns how the turn ended. The caller decides what that means for the
   * run: a prompt that resolves has not necessarily produced an answer.
   */
  async send(sessionKey: string, prompt: string | AgentPromptBlock[]): Promise<{ stopReason?: string }> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error("That agent is no longer running. Start it again.");
    if (session.busy) throw new Error("This agent already has an active turn. Stop it or wait before sending again.");
    try {
      return await session.prompt(prompt);
    } finally {
      this.emitter.emit("acp-reply", { sessionKey, done: true });
    }
  }

  async steerAcp(_sessionKey: string, _instruction: string): Promise<void> {
    throw new Error("Direct mode does not support steering. Stop the active turn or wait, then send a follow-up.");
  }

  async cancelAcp(sessionKey: string, _runId?: string): Promise<void> {
    await this.sessions.get(sessionKey)?.cancel();
  }

  async closeAcp(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    this.mcpDisposers.get(sessionKey)?.();
    this.mcpDisposers.delete(sessionKey);
    await session?.close();
    this.sessions.delete(sessionKey);
    this.harnessBySession.delete(sessionKey);
  }

  async closeAll(): Promise<void> {
    const keys = [...this.sessions.keys()];
    await Promise.all(keys.map((key) => this.closeAcp(key)));
  }

  async statusAcp(sessionKey: string): Promise<{ text: string; parsed: ReturnType<typeof parseAcpStatus> }> {
    const session = this.sessions.get(sessionKey);
    const harnessId = this.harnessBySession.get(sessionKey);
    const text = session?.running
      ? `backend: direct\nstate: ${session.busy ? "running" : "idle"}\nmode: persistent${harnessId ? `\nbackend-agent: ${harnessId}` : ""}`
      : "state: closed";
    /*
     * The agent named its models when the session opened, so hand them over —
     * the composer's picker reads exactly this. Parsing them back out of the
     * text above would be inventing a format to immediately re-read.
     */
    const models = session?.models;
    return {
      text,
      parsed: {
        ...parseAcpStatus(text),
        reported: session?.reportedCapabilities,
        configOptions: session?.reportedCapabilities?.configOptions,
        contextUsage: session?.reportedContext,
        ...(models ? { models, ...(models.currentModelId ? { model: models.currentModelId } : {}) } : {}),
      },
    };
  }

  async doctorAcp(sessionKey: string): Promise<string> {
    const session = this.sessions.get(sessionKey);
    return session?.running
      ? "Direct mode: the agent is running on this Mac and answering."
      : "Direct mode: no agent is running for this thread.";
  }

  /** Map only model/mode categories; permission profiles are not interchangeable. */
  async setAcpOption(sessionKey: string, key: HarnessOptionKey, value: string): Promise<string> {
    const session = this.sessions.get(sessionKey);
    if (!session?.running) throw new Error("That agent is no longer running. Start it again.");
    if (key !== "model" && key !== "mode") throw new Error(`Direct mode does not map ${key} to an agent setting. Use the exact reported option in Agent settings.`);
    const option = session.reportedCapabilities?.configOptions.find((item) => item.type !== "boolean" && (item.category === key || item.id === key));
    if (!option) throw new Error(`This agent does not report a mutable ${key} option. Start it again with the desired CLI configuration.`);
    await session.setConfig(option.id, value);
    return `Updated ${option.name}.`;
  }

  async setConfig(sessionKey: string, configId: string, value: string | boolean): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error("That agent is no longer running. Start it again.");
    await session.setConfig(configId, value);
  }

  private wire(key: string, session: DirectAcpSession): void {
    session.on("configuration", () => this.emitter.emit("activity", { type: "configuration", sessionKey: key }));
    session.on("message-end", () => this.emitter.emit("acp-reply", { sessionKey: key, done: true }));
    session.on("usage", (usage) => this.emitter.emit("activity", { type: "usage", sessionKey: key, usage }));
    session.on("tool", (tool) => this.emitter.emit("activity", { type: "tool", sessionKey: key, tool }));
    session.on("permission", (request) => {
      if (!this.emitter.emit("activity", { type: "permission", sessionKey: key, request })) request.cancel();
    });
    session.on("text", ({ text, thought }) => {
      // A thought is shown as it streams but is not part of the reply, so it
      // does not get folded into the message the turn produced.
      this.emitter.emit("acp-reply", { sessionKey: key, text, control: thought });
    });
    session.on("exit", ({ stderr }) => {
      this.mcpDisposers.get(key)?.();
      this.mcpDisposers.delete(key);
      const harnessId = this.harnessBySession.get(key);
      this.sessions.delete(key);
      this.harnessBySession.delete(key);
      /*
       * One sentence, and one worth reading. This used to append the whole of
       * stderr to the thread, so a failure arrived as a usage block and a
       * footer telling the reader to try --help. What they need is the line
       * that says what broke and, where we know it, what to do about it.
       */
      const detail = readCliError(stderr ?? "");
      const label = PRESET_HARNESSES.find((preset) => preset.id === harnessId)?.name ?? "The agent";
      this.emitter.emit("acp-reply", {
        sessionKey: key,
        text: detail ? `\n${explainDirectFailure(detail, label)}` : undefined,
        done: true,
      });
    });
  }
}
