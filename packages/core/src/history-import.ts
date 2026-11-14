import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { directLaunchSignature } from "@capsule/acp";
import type { CapsuleRepositories } from "@capsule/database";
import { createSessionRecord, titleFromPrompt } from "@capsule/sessions";
import {
  IMPORT_AGENT_IDS,
  createId,
  importContinuation,
  isImportAgentId,
  nowIso,
  type ChatMessage,
  type ImportAgentId,
  type ImportListing,
  type ImportSessionInput,
  type ImportableSession,
  type Project,
  type Session,
} from "@capsule/shared";
import { HISTORY_SOURCES, type HistorySource, type ParsedHistory } from "./history-parsers.js";

/** What the engine lends history import. */
export interface HistoryImportHost {
  repos: CapsuleRepositories;
  env: NodeJS.ProcessEnv;
  assertWorkAllowed(): void;
  requireProject(id: string): Project;
  /** The route a new thread on this agent would take right now. */
  route(agent: ImportAgentId): "direct" | "gateway" | "mock";
  permissionProfile(): Session["permissionProfile"];
  emit(command: "sessions-updated"): void;
  log(message: string): void;
}

/**
 * Reads coding agents' own session histories for a project folder and turns
 * one into a Capsule thread. The agent's files are only ever read.
 */
export class HistoryImport {
  constructor(private readonly host: HistoryImportHost, private readonly sources: Record<ImportAgentId, HistorySource> = HISTORY_SOURCES) {}

  async list(projectId: string): Promise<ImportListing> {
    const cwd = this.folder(this.host.requireProject(projectId));
    const imported = this.importedIds(projectId);
    const sessions: ImportableSession[] = [];
    const sources = await Promise.all(IMPORT_AGENT_IDS.map(async (agent) => {
      const source = this.sources[agent];
      const root = source.root(this.host.env);
      if (!cwd || !existsSync(root)) return { agent, found: existsSync(root) };
      const decision = importContinuation(this.host.route(agent));
      for (const parsed of await this.read(source, root, cwd)) {
        const firstPrompt = parsed.turns[0]!.prompt;
        sessions.push({
          agent,
          nativeSessionId: parsed.nativeSessionId,
          cwd: parsed.cwd,
          title: parsed.title?.trim() || titleFromPrompt(firstPrompt),
          firstPrompt: firstPrompt.slice(0, 280),
          turnCount: parsed.turns.length,
          lastActivity: parsed.lastActivity,
          ...decision,
          ...(imported.has(`${agent}:${parsed.nativeSessionId}`) ? { importedAs: imported.get(`${agent}:${parsed.nativeSessionId}`) } : {}),
        });
      }
      return { agent, found: true };
    }));
    sessions.sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1));
    return { sessions, sources };
  }

  /** Import one session as a thread. Importing it again opens the thread made the first time. */
  async import(input: ImportSessionInput): Promise<Session> {
    this.host.assertWorkAllowed();
    if (!isImportAgentId(input.agent)) throw new Error("Capsule cannot import sessions from that agent.");
    const project = this.host.requireProject(input.projectId);
    const cwd = this.folder(project);
    if (!cwd) throw new Error("Attach a folder to this project first. Sessions are matched to the folder they ran in.");
    const existing = this.importedIds(project.id).get(`${input.agent}:${input.nativeSessionId}`);
    if (existing) return this.host.repos.getSession(existing)!;
    const source = this.sources[input.agent];
    const parsed = (await this.read(source, source.root(this.host.env), cwd, input.nativeSessionId))[0];
    if (!parsed) throw new Error("That session is no longer in the agent's history for this folder.");

    const { continuation, reason } = importContinuation(this.host.route(input.agent));
    const launchSignature = directLaunchSignature(input.agent);
    const session = createSessionRecord(project, {
      projectId: project.id,
      title: parsed.title?.trim() || titleFromPrompt(parsed.turns[0]!.prompt),
      mode: "code",
      workspaceMode: "local",
    }, input.agent);
    session.harnessId = input.agent;
    session.permissionProfile = this.host.permissionProfile();
    const resumes = continuation === "resume" && launchSignature !== undefined;
    if (resumes) {
      session.directSession = { sessionId: parsed.nativeSessionId, harnessId: input.agent, cwd, launchSignature };
      session.carryOver = { route: "direct" };
    } else {
      session.carryOver = { replayTranscript: true };
    }
    session.origin = {
      kind: "import",
      agent: input.agent,
      nativeSessionId: parsed.nativeSessionId,
      continuation: resumes ? "resume" : "replay",
      ...(resumes ? {} : { reason: reason ?? "This agent has no direct mode to reopen the session in." }),
      importedAt: nowIso(),
    };
    this.host.repos.insertSession(session);
    for (const message of transcript(session.id, parsed)) this.host.repos.insertMessage(message);
    this.host.log(`Imported a ${input.agent} session (${parsed.turns.length} turn${parsed.turns.length === 1 ? "" : "s"}) into ${session.title}.`);
    this.host.emit("sessions-updated");
    return this.host.repos.getSession(session.id) ?? session;
  }

  private folder(project: Project): string | undefined {
    return project.workingDirectory ? path.resolve(project.workingDirectory) : undefined;
  }

  private importedIds(projectId: string): Map<string, string> {
    const ids = new Map<string, string>();
    for (const session of this.host.repos.listSessions(projectId)) {
      if (session.origin?.kind === "import") ids.set(`${session.origin.agent}:${session.origin.nativeSessionId}`, session.id);
    }
    return ids;
  }

  private async read(source: HistorySource, root: string, cwd: string, only?: string): Promise<ParsedHistory[]> {
    const files = (await source.files(root, cwd).catch(() => [])).filter((file) => !only || path.basename(file).includes(only));
    const parsed: ParsedHistory[] = [];
    for (const file of files) {
      const raw = await readFile(file, "utf8").catch(() => undefined);
      const history = raw === undefined ? undefined : source.parse(raw.split("\n"), file);
      if (!history || history.cwd !== cwd || (only && history.nativeSessionId !== only)) continue;
      if (history.skipped) this.host.log(`Skipped ${history.skipped} unreadable line${history.skipped === 1 ? "" : "s"} in ${path.basename(file)}.`);
      parsed.push(history);
    }
    return parsed;
  }
}

/** Prompts and final replies, timestamped in order so the thread reads as it happened. */
function transcript(sessionId: string, parsed: ParsedHistory): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let previous = 0;
  const next = (at: string | undefined) => {
    const parsedAt = at ? Date.parse(at) : Number.NaN;
    previous = Math.max(Number.isFinite(parsedAt) ? parsedAt : previous + 1, previous + 1);
    return new Date(previous).toISOString();
  };
  for (const turn of parsed.turns) {
    messages.push({ id: createId("msg"), sessionId, role: "user", content: turn.prompt, createdAt: next(turn.at) });
    if (turn.reply) messages.push({ id: createId("msg"), sessionId, role: "assistant", content: turn.reply, createdAt: next(undefined) });
  }
  return messages;
}
