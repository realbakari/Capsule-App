import { existsSync } from "node:fs";
import {
  aggregateLeaderboard,
  candidateTitle,
  createId,
  parseUnifiedDiff,
  readReportedContextUsage,
  readReportedTurnUsage,
  type AgentMessage,
  type ApplyResult,
  type CandidateSummary,
  type CreateSessionInput,
  type GroupComparison,
  type HarnessId,
  type LeaderboardRow,
  type MessageAttachment,
  type Project,
  type RatingValue,
  type Run,
  type ScopedDiff,
  type Session,
  type StartBestOfNInput,
  type StartBestOfNResult,
  type ThreadGroup,
} from "@capsule/shared";
import type { CapsuleRepositories } from "@capsule/database";
import { hasCheckpoint, restoreWorktree, setAsideWorktree, threadSnapshotRef } from "@capsule/filesystem";
import { presetFor } from "@capsule/harness";
import { titleFromPrompt } from "@capsule/sessions";

/**
 * Best-of-N: one prompt on several agents, compared, one kept.
 *
 * Each candidate is an ordinary worktree thread with its own agent, model,
 * route and agent session, so nothing a thread does is reimplemented here.
 * This owns only what is new: making the threads together, reading them
 * side by side, recording which one was kept, setting the others aside, and
 * the local ratings that feed the leaderboard.
 */

type Repos = Pick<CapsuleRepositories,
  | "getSession" | "listSessions" | "updateSession" | "setSessionGroup" | "getProject" | "updateProject"
  | "insertThreadGroup" | "listThreadGroups" | "getThreadGroup" | "setThreadGroupWinner"
  | "listRuns" | "getRun" | "listRunEvents" | "listMessages"
  | "setRunRating" | "clearRunRating" | "listRunRatings">;

export interface BestOfNHost {
  repos: Repos;
  assertWorkAllowed(): void;
  requireProject(id: string): Project;
  isGitRepository(folder: string): Promise<boolean>;
  /** Why this agent cannot start a new thread now, or undefined. */
  startRefusal(harnessId: HarnessId): string | undefined;
  validateAttachments(attachments: MessageAttachment[]): MessageAttachment[];
  createSession(input: CreateSessionInput): Promise<Session>;
  deleteSession(id: string): Promise<void>;
  /** The same path as pressing send in the thread. */
  send(message: AgentMessage): Promise<unknown>;
  isBusy(sessionId: string): boolean;
  route(session: Session): "direct" | "gateway" | undefined;
  applyToLocal(sessionId: string): Promise<ApplyResult>;
  /** Ends a live agent session before its folder goes. Never throws. */
  closeAgent(sessionId: string): Promise<void>;
  scopedDiff(folder: string): Promise<ScopedDiff>;
  emit(): void;
  log(message: string): void;
  now(): string;
}

const REPLY_EXCERPT = 600;

export class BestOfNService {
  /** Prompts that never reached their candidate, until the app quits. The thread is still there to send from. */
  private readonly startErrors = new Map<string, string>();

  constructor(private readonly host: BestOfNHost) {}

  async start(input: StartBestOfNInput): Promise<StartBestOfNResult> {
    this.host.assertWorkAllowed();
    const project = this.host.requireProject(input.projectId);
    if (!project.workingDirectory || !(await this.host.isGitRepository(project.workingDirectory))) {
      throw new Error("Running on several agents needs a Git repository: each agent works in its own worktree.");
    }
    const attachments = this.host.validateAttachments(input.attachments ?? []);
    if (!input.prompt.trim() && attachments.length === 0) throw new Error("Write a message or attach a file first.");
    const refusals = [...new Set(input.candidates.map((candidate) => candidate.harnessId))]
      .map((harnessId) => this.host.startRefusal(harnessId))
      .filter((reason): reason is string => Boolean(reason));
    if (refusals.length) throw new Error(refusals.join(" "));

    const groupId = createId("grp");
    const promptTitle = titleFromPrompt(input.prompt.trim() || attachments[0]?.name || "New conversation");
    const created: Session[] = [];
    try {
      for (const candidate of input.candidates) {
        const name = presetFor(candidate.harnessId)?.name ?? candidate.harnessId;
        const session = await this.host.createSession({
          projectId: project.id,
          agentId: candidate.harnessId,
          mode: "code",
          title: candidateTitle(promptTitle, name, candidate.model),
          workspaceMode: "worktree",
          ...(input.permissionProfile ? { permissionProfile: input.permissionProfile } : {}),
        });
        created.push(session);
        if (session.workspaceMode !== "worktree") throw new Error("A candidate could not get its own worktree.");
        if (candidate.model) {
          session.modelOverride = candidate.model;
          this.host.repos.updateSession(session);
        }
        this.host.repos.setSessionGroup(session.id, groupId);
      }
    } catch (error) {
      for (const session of created) await this.host.deleteSession(session.id).catch(() => undefined);
      throw error;
    }

    const group: ThreadGroup = {
      id: groupId,
      projectId: project.id,
      kind: "best-of-n",
      prompt: input.prompt,
      candidates: created.map((session, index) => ({ sessionId: session.id, harnessId: input.candidates[index]!.harnessId, model: input.candidates[index]!.model ?? "" })),
      createdAt: this.host.now(),
    };
    this.host.repos.insertThreadGroup(group);
    this.host.emit();
    void this.sendAll(group, attachments, input.permissionProfile);
    return { group, sessionIds: created.map((session) => session.id) };
  }

  /*
   * Different agents start side by side. Two candidates of the same agent
   * start one after the other: on the Gateway route each start may write
   * that agent's registration, and two writes of it at once can race. They
   * still get separate agent sessions and separate worktrees.
   */
  private async sendAll(group: ThreadGroup, attachments: MessageAttachment[], permissionProfile: StartBestOfNInput["permissionProfile"]): Promise<void> {
    const project = this.host.repos.getProject(group.projectId);
    const priorDefault = project ? { agentId: project.defaultAgentId, mode: project.defaultMode } : undefined;
    const lanes = new Map<string, typeof group.candidates>();
    for (const candidate of group.candidates) lanes.set(candidate.harnessId, [...(lanes.get(candidate.harnessId) ?? []), candidate]);
    await Promise.all([...lanes.values()].map(async (lane) => {
      for (const candidate of lane) {
        try {
          await this.host.send({
            sessionId: candidate.sessionId,
            content: group.prompt,
            agentId: candidate.harnessId,
            mode: "code",
            ...(attachments.length ? { attachments } : {}),
            ...(permissionProfile ? { permissionProfile } : {}),
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          // A start that failed after its turn was recorded shows as that turn's failure.
          if (this.host.repos.listRuns(candidate.sessionId).length === 0) this.startErrors.set(candidate.sessionId, reason);
          this.host.log(`A best-of-N candidate did not start: ${reason}`);
        }
      }
    }));
    /*
     * Starting an agent makes it the project's default, which is how a single
     * conversation remembers the choice. A comparison is not a choice of one
     * agent, so the project keeps the default it had.
     */
    const current = this.host.repos.getProject(group.projectId);
    if (current && priorDefault && (current.defaultAgentId !== priorDefault.agentId || current.defaultMode !== priorDefault.mode)) {
      this.host.repos.updateProject({ ...current, defaultAgentId: priorDefault.agentId, defaultMode: priorDefault.mode, updatedAt: this.host.now() });
    }
    this.host.emit();
  }

  listGroups(): ThreadGroup[] {
    return this.host.repos.listThreadGroups();
  }

  async compare(groupId: string): Promise<GroupComparison> {
    const group = this.requireGroup(groupId);
    const ratings = new Map(this.host.repos.listRunRatings().map((rating) => [rating.runId, rating.value]));
    const candidates = await Promise.all(this.members(group).map((session) => this.summarize(session, ratings)));
    return { group, candidates };
  }

  /** Apply the candidate's worktree to the project folder; the group records it as kept only if something landed. */
  async keep(groupId: string, sessionId: string): Promise<ApplyResult> {
    this.host.assertWorkAllowed();
    const group = this.requireGroup(groupId);
    const session = this.requireMember(group, sessionId);
    if (session.state === "archived") return { applied: false, files: [], conflicts: [], detail: "Restore this thread before keeping it." };
    const result = await this.host.applyToLocal(sessionId);
    if (result.applied) {
      this.host.repos.setThreadGroupWinner(group.id, sessionId, this.host.now());
      this.host.log(`Kept ${session.title} from a comparison of ${group.candidates.length} agents.`);
      this.host.emit();
    }
    return result;
  }

  /** Undoing the kept candidate's apply undoes the keep. */
  applyUndone(sessionId: string): void {
    const groupId = this.host.repos.getSession(sessionId)?.groupId;
    const group = groupId ? this.host.repos.getThreadGroup(groupId) : undefined;
    if (!group || group.winnerSessionId !== sessionId) return;
    this.host.repos.setThreadGroupWinner(group.id, undefined, undefined);
    this.host.emit();
  }

  /**
   * Archive every candidate but the kept one and take their worktrees off
   * disk, saving each first. Restoring a thread brings its worktree back.
   */
  async setAside(groupId: string): Promise<{ archived: string[]; failed: Array<{ sessionId: string; reason: string }> }> {
    this.host.assertWorkAllowed();
    const group = this.requireGroup(groupId);
    if (!group.winnerSessionId) throw new Error("Keep one candidate first.");
    const losers = this.members(group).filter((session) => session.id !== group.winnerSessionId && session.state === "active");
    const working = losers.filter((session) => this.host.isBusy(session.id));
    if (working.length) {
      throw new Error(`${working.length === 1 ? "One candidate is" : `${working.length} candidates are`} still working. Stop ${working.length === 1 ? "it" : "them"} first.`);
    }
    const checkout = this.host.requireProject(group.projectId).workingDirectory;
    const archived: string[] = [];
    const failed: Array<{ sessionId: string; reason: string }> = [];
    for (const session of losers) {
      if (checkout && session.workspaceMode === "worktree" && session.workingDirectory && existsSync(session.workingDirectory)) {
        await this.host.closeAgent(session.id);
        const result = await setAsideWorktree(checkout, session.workingDirectory, threadSnapshotRef(session.id, "set-aside"));
        if (!result.ok) {
          failed.push({ sessionId: session.id, reason: result.detail });
          continue;
        }
      }
      const current = this.host.repos.getSession(session.id) ?? session;
      this.host.repos.updateSession({ ...current, state: "archived", updatedAt: this.host.now() });
      archived.push(session.id);
    }
    if (archived.length) this.host.log(`Set aside ${archived.length} candidate${archived.length === 1 ? "" : "s"} from a comparison.`);
    this.host.emit();
    return { archived, failed };
  }

  /** Before an archived thread comes back: put back a worktree that was set aside. Does nothing otherwise. */
  async beforeRestore(session: Session): Promise<void> {
    if (session.workspaceMode !== "worktree" || !session.workingDirectory || !session.worktreeBranch || existsSync(session.workingDirectory)) return;
    const checkout = this.host.repos.getProject(session.projectId)?.workingDirectory;
    const ref = threadSnapshotRef(session.id, "set-aside");
    if (!checkout || !(await hasCheckpoint(checkout, ref))) return;
    const result = await restoreWorktree(checkout, session.workingDirectory, session.worktreeBranch, ref);
    if (!result.ok) throw new Error(result.detail);
    this.host.log(result.detail);
  }

  rate(runId: string, value: RatingValue | 0): void {
    const run = this.host.repos.getRun(runId);
    const session = run ? this.host.repos.getSession(run.sessionId) : undefined;
    if (!run || !session) throw new Error("That reply is no longer in this conversation.");
    if (value === 0) this.host.repos.clearRunRating(runId);
    else this.host.repos.setRunRating({
      runId,
      sessionId: session.id,
      harnessId: session.harnessId ?? session.agentId,
      model: session.modelOverride ?? "",
      value,
      createdAt: this.host.now(),
    });
  }

  ratings(sessionId: string): Record<string, RatingValue> {
    return Object.fromEntries(this.host.repos.listRunRatings(sessionId).map((rating) => [rating.runId, rating.value]));
  }

  leaderboard(): LeaderboardRow[] {
    const entries = this.host.repos.listThreadGroups().flatMap((group) =>
      group.candidates.map((candidate) => ({ harnessId: candidate.harnessId, model: candidate.model, kept: group.winnerSessionId === candidate.sessionId })));
    return aggregateLeaderboard(entries, this.host.repos.listRunRatings());
  }

  private members(group: ThreadGroup): Session[] {
    const sessions = this.host.repos.listSessions(group.projectId).filter((session) => session.groupId === group.id);
    const order = new Map(group.candidates.map((candidate, index) => [candidate.sessionId, index]));
    return sessions.sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size) || a.createdAt.localeCompare(b.createdAt));
  }

  private requireGroup(id: string): ThreadGroup {
    const group = this.host.repos.getThreadGroup(id);
    if (!group) throw new Error("That comparison no longer exists.");
    return group;
  }

  private requireMember(group: ThreadGroup, sessionId: string): Session {
    const session = this.host.repos.getSession(sessionId);
    if (!session || session.groupId !== group.id) throw new Error("That thread is not part of this comparison.");
    return session;
  }

  private async summarize(session: Session, ratings: ReadonlyMap<string, RatingValue>): Promise<CandidateSummary> {
    const run = this.host.repos.listRuns(session.id)[0];
    const folder = session.workspaceMode === "worktree" ? session.workingDirectory : undefined;
    const present = Boolean(folder && existsSync(folder));
    const checkout = this.host.repos.getProject(session.projectId)?.workingDirectory;
    const setAside = !present && session.state === "archived" && Boolean(checkout) && await hasCheckpoint(checkout!, threadSnapshotRef(session.id, "set-aside"));
    const startError = run ? undefined : this.startErrors.get(session.id);
    return {
      sessionId: session.id,
      title: session.title,
      harnessId: session.harnessId ?? session.agentId,
      ...(session.modelOverride ? { model: session.modelOverride } : {}),
      ...(this.host.route(session) ? { route: this.host.route(session) } : {}),
      ...(session.worktreeBranch ? { branch: session.worktreeBranch } : {}),
      archived: session.state === "archived",
      worktree: present ? "present" : setAside ? "set-aside" : "missing",
      ...(run ? { run: { id: run.id, status: run.status, createdAt: run.createdAt, ...(run.completedAt ? { completedAt: run.completedAt } : {}), ...(run.error ? { error: run.error } : {}) } } : {}),
      ...(startError ? { startError } : {}),
      ...(present ? { diff: await this.diffStats(folder!) } : {}),
      ...(run?.verification ? { verification: run.verification.status } : {}),
      ...(run ? this.usage(run) : {}),
      ...(run ? this.reply(session, run) : {}),
      ...(run && ratings.has(run.id) ? { rating: ratings.get(run.id) } : {}),
    };
  }

  private async diffStats(folder: string): Promise<NonNullable<CandidateSummary["diff"]>> {
    try {
      const files = parseUnifiedDiff((await this.host.scopedDiff(folder)).patch)
        .map((file) => ({ path: file.path, added: file.additions, removed: file.deletions }));
      return { files, added: files.reduce((sum, file) => sum + file.added, 0), removed: files.reduce((sum, file) => sum + file.removed, 0) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private usage(run: Run): Pick<CandidateSummary, "usage"> {
    const events = this.host.repos.listRunEvents(run.id).reverse();
    const turn = readReportedTurnUsage(events.find((event) => event.type === "usage.turn")?.data?.usage);
    const context = readReportedContextUsage(events.find((event) => event.type === "usage.context")?.data?.context);
    if (!turn && !context?.cost) return {};
    return { usage: {
      ...(turn?.inputTokens !== undefined ? { inputTokens: turn.inputTokens } : {}),
      ...(turn?.outputTokens !== undefined ? { outputTokens: turn.outputTokens } : {}),
      ...(turn?.totalTokens !== undefined ? { totalTokens: turn.totalTokens } : {}),
      ...(context?.cost ? { cost: context.cost } : {}),
    } };
  }

  private reply(session: Session, run: Run): Pick<CandidateSummary, "reply"> {
    const text = this.host.repos.getRun(run.id)?.result?.trim()
      || this.host.repos.listMessages(session.id).filter((message) => message.runId === run.id && message.role === "assistant").at(-1)?.content.trim();
    if (!text) return {};
    return { reply: text.length > REPLY_EXCERPT ? `${text.slice(0, REPLY_EXCERPT).trimEnd()}…` : text };
  }
}
