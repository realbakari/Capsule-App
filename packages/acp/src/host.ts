import { EventEmitter } from "node:events";

import {
  PRESET_HARNESSES,
  parseAcpStatus,
  type HarnessId,
  type HarnessOptionKey,
  type Unsubscribe,
} from "@capsule/shared";

import { DirectAcpSession } from "./session.js";

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
  harnessId: HarnessId;
  cwd?: string;
  title?: string;
  prompt?: string;
  sessionKey?: string;
  model?: string;
}

export interface AcpReply {
  sessionKey?: string;
  text?: string;
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
  readonly kind = "direct" as const;

  private readonly emitter = new EventEmitter();
  private readonly sessions = new Map<string, DirectAcpSession>();
  private readonly harnessBySession = new Map<string, HarnessId>();
  private counter = 0;

  onAcpReply(handler: (payload: AcpReply) => void): Unsubscribe {
    this.emitter.on("acp-reply", handler);
    return () => this.emitter.off("acp-reply", handler);
  }

  /** What a user would run to get the same thing in a terminal. */
  acpCommandFor(harnessId: HarnessId): string {
    const preset = PRESET_HARNESSES.find((item) => item.id === harnessId);
    if (!preset?.acpxCommand) return "";
    return [preset.acpxCommand.command, ...(preset.acpxCommand.args ?? [])].join(" ");
  }

  async spawnAcpSession(
    input: DirectSpawnInput,
  ): Promise<{ sessionKey: string; usedSlashCommand: boolean; command: string }> {
    const preset = PRESET_HARNESSES.find((item) => item.id === input.harnessId);
    if (!preset?.acpxCommand) {
      throw new Error(
        `${preset?.name ?? input.harnessId} has no ACP mode of its own, so direct mode cannot drive it. Switch this thread to the OpenClaw Gateway, or pick an agent that does.`,
      );
    }

    // A key that is still live is the session; re-spawning would strand it.
    if (input.sessionKey && this.sessions.get(input.sessionKey)?.running) {
      return {
        sessionKey: input.sessionKey,
        usedSlashCommand: false,
        command: this.acpCommandFor(input.harnessId),
      };
    }

    const args = [...(preset.acpxCommand.args ?? [])];
    // A model asked for at spawn time wins over the preset's own choice.
    if (input.model) {
      const flag = args.indexOf("--model");
      if (flag >= 0) args[flag + 1] = input.model;
      else args.push("--model", input.model);
    }

    const session = new DirectAcpSession({
      command: preset.acpxCommand.command,
      args,
      cwd: input.cwd,
    });

    const key = directSessionKey(input.harnessId, `${Date.now().toString(36)}${this.counter++}`);
    this.wire(key, session);
    await session.start();
    this.sessions.set(key, session);
    this.harnessBySession.set(key, input.harnessId);

    if (input.prompt) void this.send(key, input.prompt);
    return {
      sessionKey: key,
      usedSlashCommand: false,
      command: [preset.acpxCommand.command, ...args].join(" "),
    };
  }

  /** Send a turn. The reply arrives through `onAcpReply`, as the Gateway's does. */
  async send(sessionKey: string, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    if (!session) throw new Error("That agent is no longer running. Start it again.");
    try {
      await session.prompt(prompt);
    } finally {
      this.emitter.emit("acp-reply", { sessionKey, done: true });
    }
  }

  async steerAcp(sessionKey: string, instruction: string): Promise<void> {
    // Direct mode has no separate steer channel: the agent takes a new turn,
    // which is what steering is once a turn is already running.
    await this.send(sessionKey, instruction);
  }

  async cancelAcp(sessionKey: string, _runId?: string): Promise<void> {
    await this.sessions.get(sessionKey)?.cancel();
  }

  async closeAcp(sessionKey: string): Promise<void> {
    const session = this.sessions.get(sessionKey);
    this.sessions.delete(sessionKey);
    this.harnessBySession.delete(sessionKey);
    await session?.close();
  }

  async closeAll(): Promise<void> {
    const keys = [...this.sessions.keys()];
    await Promise.all(keys.map((key) => this.closeAcp(key)));
  }

  async statusAcp(sessionKey: string): Promise<{ text: string; parsed: ReturnType<typeof parseAcpStatus> }> {
    const session = this.sessions.get(sessionKey);
    const harnessId = this.harnessBySession.get(sessionKey);
    const text = session?.running
      ? `backend: direct\nstate: running\nmode: persistent${harnessId ? `\nbackend-agent: ${harnessId}` : ""}`
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

  /**
   * Options are the CLI's own, and direct mode has no channel to change them
   * mid-session. Saying so is better than accepting the change and dropping it.
   */
  async setAcpOption(_sessionKey: string, key: HarnessOptionKey, _value: string): Promise<string> {
    if (key === "model") {
      return "Direct mode fixes the model when the agent starts. Close the agent and start it again to change it.";
    }
    return `Direct mode does not carry ${key}; it is the CLI's own setting.`;
  }

  private wire(key: string, session: DirectAcpSession): void {
    session.on("text", ({ text, thought }) => {
      // A thought is shown as it streams but is not part of the reply, so it
      // does not get folded into the message the turn produced.
      this.emitter.emit("acp-reply", { sessionKey: key, text, control: thought });
    });
    session.on("exit", ({ stderr }) => {
      this.sessions.delete(key);
      this.harnessBySession.delete(key);
      this.emitter.emit("acp-reply", {
        sessionKey: key,
        text: stderr ? `\n${stderr}` : undefined,
        done: true,
      });
    });
  }
}
