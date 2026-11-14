import { isDirectSessionKey } from "@capsule/acp";
import type { CapsuleRepositories, RestorePointRecord } from "@capsule/database";
import {
  captureCheckpoint,
  checkpointRef,
  copyCheckpointRef,
  deleteCheckpointRef,
  restoreCheckpoint,
  threadSnapshotRef,
} from "@capsule/filesystem";
import { createSessionRecord } from "@capsule/sessions";
import {
  createId,
  nowIso,
  type ChatMessage,
  type ForkBranch,
  type ForkBranchGroup,
  type ForkSessionInput,
  type Project,
  type RedoPoint,
  type RestoreResult,
  type RestoreScope,
  type Run,
  type Session,
  type SessionCarryOver,
} from "@capsule/shared";

/** What the engine lends branching: its guards, its agent lifecycle and its folders. */
export interface BranchingHost {
  repos: CapsuleRepositories;
  assertWorkAllowed(): void;
  turnActive(sessionId: string): boolean;
  cwdForRun(run: Run): string | undefined;
  /** Why the folder cannot be rewritten for this thread right now, or undefined. */
  folderRefusal(sessionId: string, cwd: string, since: string): string | undefined;
  /** Rewrite the folder from a ref while holding its lock, after an optional snapshot. */
  rewriteFolder(cwd: string, ref: string, snapshotTo?: string): Promise<{ ok: boolean; detail: string }>;
  /** Close the thread's live agent session, if any. Failure is not fatal: the identity is dropped anyway. */
  closeAgent(session: Session): Promise<void>;
  attachWorktree(session: Session, project: Project): Promise<void>;
  requireProject(id: string): Project;
  emit(command: "harness-updated" | "files-updated" | "sessions-updated"): void;
  log(message: string): void;
}

const ACTIVE = new Set(["queued", "running", "waiting", "approval_required"]);
const REPLAY_LIMIT = 48_000;

/** A plan for one restore, before anything changes. */
interface RestorePlan {
  session: Session;
  scope: RestoreScope;
  /** The kept turn; absent when Edit from here removes the first prompt. */
  target?: Run;
  /** Files come from this turn's checkpoint. */
  filesFrom?: Run;
  /** First message to hide; absent when nothing follows the target. */
  cutMessageId?: string;
  edit?: { prompt: ChatMessage };
}

/** Which route a fresh agent session for this thread takes, and what it keeps. */
export function carryOverFor(session: Session, replayTranscript: boolean): SessionCarryOver | undefined {
  const route = session.directSession || isDirectSessionKey(session.openclawSessionKey) ? "direct" : session.openclawSessionKey ? "gateway" : session.carryOver?.route;
  const configuration = session.directSession?.configuration ?? session.carryOver?.configuration;
  const carry: SessionCarryOver = {
    ...(route ? { route } : {}),
    ...(configuration ? { configuration } : {}),
    ...(replayTranscript ? { replayTranscript: true } : {}),
  };
  return Object.keys(carry).length ? carry : undefined;
}

/**
 * The thread so far, for an agent session that starts without it. Newest
 * messages are kept when it is long: the last turns matter most to whatever
 * the user asks next.
 */
export function transcriptContext(messages: ChatMessage[]): string {
  const lines = messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === "user" ? (message.kind === "steer" ? "User (steering)" : "User") : "Assistant"}: ${message.content.trim()}`);
  let body = lines.join("\n\n");
  let note = "";
  if (body.length > REPLAY_LIMIT) {
    body = body.slice(body.length - REPLAY_LIMIT);
    note = "Earlier messages were left out for length.\n\n";
  }
  return `<conversation-so-far>\nThis is a fresh agent session for a conversation that already has history. The messages below are that history, for context; the request follows after.\n\n${note}${body}\n</conversation-so-far>\n\n`;
}

export class Branching {
  constructor(private readonly host: BranchingHost) {}

  private get repos(): CapsuleRepositories {
    return this.host.repos;
  }

  /** Restore a thread to one of its turns: its files, its conversation, or both. */
  async restore(runId: string, scope: RestoreScope): Promise<RestoreResult> {
    this.host.assertWorkAllowed();
    const target = this.repos.getRun(runId);
    const session = target ? this.repos.getSession(target.sessionId) : undefined;
    if (!target || !session) return { ok: false, detail: "That turn is no longer in this conversation." };
    const files = scope !== "conversation";
    if (files && !target.checkpointRef) return { ok: false, detail: "That turn has no checkpoint, so its files cannot be restored. Restore the conversation only." };
    return this.apply({ session, scope, target, filesFrom: files ? target : undefined, cutMessageId: scope === "files" ? undefined : this.cutAfter(session.id, target.id) });
  }

  /**
   * Edit from here: a conversation restore to the turn before a prompt, which
   * also hands the prompt back. With files, the folder goes to that turn too.
   */
  async editFrom(sessionId: string, messageId: string, restoreFiles: boolean): Promise<RestoreResult> {
    this.host.assertWorkAllowed();
    const session = this.repos.getSession(sessionId);
    if (!session) return { ok: false, detail: "That conversation no longer exists." };
    const transcript = this.repos.listMessages(sessionId);
    const anchor = transcript.findIndex((item) => item.id === messageId);
    const prompt = transcript[anchor];
    if (!prompt || prompt.role !== "user" || prompt.kind === "steer") return { ok: false, detail: "Choose one of your own prompts to edit from." };
    const split = this.repos.splitTranscript(sessionId, messageId);
    const removed = new Set(split.after.runIds);
    /*
     * The turn before is the newest kept run. Timestamps alone are not
     * enough: a run is stamped a moment before its own prompt, so the edited
     * turn could look "earlier" than itself.
     */
    const kept = this.repos.listRuns(sessionId).filter((run) => !removed.has(run.id) && run.createdAt <= prompt.createdAt);
    const target = kept[0];
    const filesFrom = restoreFiles ? kept.find((run) => run.checkpointRef) : undefined;
    if (restoreFiles && !filesFrom) return { ok: false, detail: "No earlier turn has a checkpoint to restore files from. Edit from here without restoring files, or restore the files of a turn instead." };
    return this.apply({ session, scope: restoreFiles ? "both" : "conversation", target, filesFrom, cutMessageId: messageId, edit: { prompt } });
  }

  /** The first message after a turn's last one, where a conversation restore cuts. */
  private cutAfter(sessionId: string, runId: string): string | undefined {
    const transcript = this.repos.listMessages(sessionId);
    let last = -1;
    transcript.forEach((message, index) => { if (message.runId === runId) last = index; });
    return last < 0 ? undefined : transcript[last + 1]?.id;
  }

  private async apply(plan: RestorePlan): Promise<RestoreResult> {
    const { session } = plan;
    if (this.host.turnActive(session.id)) return { ok: false, detail: "A turn is running in this conversation. Stop it or wait before restoring." };
    const pointId = createId("restore");
    let filesRef: string | undefined;
    let filesCwd: string | undefined;
    let filesDetail = "";
    if (plan.filesFrom?.checkpointRef) {
      const cwd = this.host.cwdForRun(plan.filesFrom);
      if (!cwd) return { ok: false, detail: "That turn has no working directory." };
      const refusal = this.host.folderRefusal(session.id, cwd, plan.filesFrom.createdAt);
      if (refusal) return { ok: false, detail: refusal };
      const snapshot = threadSnapshotRef(session.id, "redo", pointId);
      const result = await this.host.rewriteFolder(cwd, plan.filesFrom.checkpointRef, snapshot);
      if (!result.ok) return result;
      filesRef = snapshot;
      filesCwd = cwd;
      filesDetail = result.detail;
    }
    const conversation = plan.scope !== "files";
    const split = conversation && plan.cutMessageId ? this.repos.splitTranscript(session.id, plan.cutMessageId) : undefined;
    const hiding = Boolean(split && (split.after.messageIds.length || split.after.runIds.length));
    let agentBefore: RestorePointRecord["agentBefore"];
    let parkedRows: RestorePointRecord["parkedRows"] = {};
    if (hiding && split) {
      await this.host.closeAgent(session);
      const current = this.repos.getSession(session.id)!;
      agentBefore = { openclawSessionKey: current.openclawSessionKey, directSession: current.directSession, harnessState: current.harnessState, carryOver: current.carryOver };
      parkedRows = this.repos.parkTranscript(split.after.messageIds, split.after.runIds);
      /*
       * The agent's session goes, so the next turn starts without the hidden
       * turns. Its route and saved controls stay, and the kept turns travel
       * with the next prompt so the fresh session is not starting blind.
       */
      current.carryOver = carryOverFor(current, split.before.messageIds.length > 0);
      current.openclawSessionKey = undefined;
      current.directSession = undefined;
      current.harnessState = "closed";
      current.updatedAt = nowIso();
      this.repos.updateSession(current);
    }
    if (!filesRef && !hiding) {
      return { ok: true, detail: plan.scope === "conversation" ? "This is the latest turn, so there was nothing to hide." : "Nothing changed." };
    }
    const point: RestorePointRecord = {
      id: pointId,
      sessionId: session.id,
      targetRunId: plan.target?.id,
      scope: plan.scope,
      edit: Boolean(plan.edit),
      createdAt: nowIso(),
      filesSaved: Boolean(filesRef),
      filesRef,
      filesCwd,
      parkedRows,
      hiddenMessages: split?.after.messageIds.length ?? 0,
      agentBefore,
    };
    this.repos.insertRestorePoint(point);
    this.host.emit("harness-updated");
    this.host.emit("files-updated");
    const hidden = point.hiddenMessages;
    const parts = [
      ...(hiding ? [`Removed ${hidden} message${hidden === 1 ? "" : "s"} from the conversation`] : []),
      ...(filesRef ? [plan.edit ? "restored the files from the turn before" : "restored the files"] : []),
    ];
    const sentence = parts.join(" and ");
    return {
      ok: true,
      detail: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.${hiding ? " The next turn starts a fresh agent session." : ""}${filesDetail.includes("Staged") ? " Staged changes were left untouched." : ""}`,
      ...(plan.edit ? { prompt: plan.edit.prompt.content, attachments: plan.edit.prompt.attachments ?? [] } : {}),
      removedMessages: hidden,
      filesRestored: Boolean(filesRef),
      redo: publicPoint(point),
    };
  }

  /** The restore Redo would reverse, or undefined once a new turn has made it moot. */
  redoPoint(sessionId: string): RedoPoint | undefined {
    const latest = this.repos.listRestorePoints(sessionId)[0];
    if (!latest || this.repos.hasMessagesSince(sessionId, latest.createdAt)) return undefined;
    return publicPoint(latest);
  }

  /** Reverse the latest restore: its files, its hidden turns and the agent session it dropped. */
  async redo(sessionId: string): Promise<RestoreResult> {
    this.host.assertWorkAllowed();
    const point = this.repos.listRestorePoints(sessionId)[0];
    if (!point) return { ok: false, detail: "There is no restore to redo in this conversation." };
    if (this.repos.hasMessagesSince(sessionId, point.createdAt)) {
      await this.discard(sessionId);
      return { ok: false, detail: "This conversation has a new turn since the restore, so it can no longer be redone." };
    }
    if (this.host.turnActive(sessionId)) return { ok: false, detail: "A turn is running in this conversation. Stop it or wait before redoing." };
    if (point.filesRef && point.filesCwd) {
      const refusal = this.host.folderRefusal(sessionId, point.filesCwd, point.createdAt);
      if (refusal) return { ok: false, detail: refusal };
      const result = await this.host.rewriteFolder(point.filesCwd, point.filesRef);
      if (!result.ok) return result;
      await deleteCheckpointRef(point.filesCwd, point.filesRef).catch(() => undefined);
    }
    if (point.hiddenMessages || Object.values(point.parkedRows).some((rows) => rows?.length)) {
      this.repos.unparkTranscript(point.parkedRows);
      const current = this.repos.getSession(sessionId)!;
      const before = point.agentBefore;
      /*
       * A direct session's native identity outlives its process, so the next
       * turn resumes the very session that remembers the turns just brought
       * back. A Gateway session was closed for good; a fresh one gets the
       * whole transcript instead.
       */
      if (before?.directSession) {
        current.openclawSessionKey = before.openclawSessionKey;
        current.directSession = before.directSession;
        current.harnessState = "closed";
        current.carryOver = before.carryOver;
      } else if (before?.openclawSessionKey) {
        current.carryOver = { ...carryOverFor(current, true), route: isDirectSessionKey(before.openclawSessionKey) ? "direct" : "gateway", replayTranscript: true };
      } else {
        current.carryOver = before?.carryOver;
      }
      current.updatedAt = nowIso();
      this.repos.updateSession(current);
    }
    this.repos.deleteRestorePoint(point.id);
    this.host.emit("harness-updated");
    this.host.emit("files-updated");
    const what = point.scope === "files" ? "the files" : point.scope === "conversation" ? "the conversation" : "the files and the conversation";
    return { ok: true, detail: `Put back ${what} as they were before the restore.`, filesRestored: point.filesSaved, removedMessages: 0 };
  }

  /** A new turn ends Redo: the hidden turns and the saved folder snapshot go. */
  async discard(sessionId: string): Promise<void> {
    for (const point of this.repos.listRestorePoints(sessionId)) {
      if (point.filesRef && point.filesCwd) await deleteCheckpointRef(point.filesCwd, point.filesRef).catch(() => undefined);
      this.repos.deleteRestorePoint(point.id);
    }
  }

  /** Diff a turn's checkpoint against the folder as it is now: what restoring its files would change. */
  async compareRefs(runId: string): Promise<{ cwd: string; from: string; to: string }> {
    const run = this.repos.getRun(runId);
    if (!run?.checkpointRef) throw new Error("That turn has no checkpoint to compare.");
    const cwd = this.host.cwdForRun(run);
    if (!cwd) throw new Error("That turn has no working directory.");
    const current = threadSnapshotRef(run.sessionId, "compare");
    const captured = await captureCheckpoint(cwd, current);
    if (!captured.ok) throw new Error(`Could not read the folder as it is now: ${captured.detail}`);
    return { cwd, from: current, to: run.checkpointRef };
  }

  /**
   * A new thread with this one's history up to and including a turn. The
   * original is only read. Agents cannot clone a live session at an older
   * turn, so the fork starts a fresh agent session that is handed the copied
   * transcript on its first prompt, on the same route the original used.
   */
  async fork(input: ForkSessionInput): Promise<Session> {
    this.host.assertWorkAllowed();
    const source = this.repos.getSession(input.sessionId);
    const run = this.repos.getRun(input.runId);
    if (!source || !run || run.sessionId !== source.id) throw new Error("That turn is no longer in this conversation.");
    if (ACTIVE.has(run.status)) throw new Error("This turn is still running. Wait for it to finish before forking from it.");
    if (input.workspace === "worktree" && !run.checkpointRef) throw new Error("That turn has no checkpoint, so a worktree cannot start from its files. Fork into the same folder instead.");
    const project = this.host.requireProject(source.projectId);
    const split = this.repos.splitTranscript(source.id, this.cutAfter(source.id, run.id));
    const fork = createSessionRecord(project, {
      projectId: project.id,
      title: `${source.title} (fork)`,
      mode: source.mode,
      workingDirectory: input.workspace === "same" ? source.workingDirectory : undefined,
      workspaceMode: input.workspace === "same" ? source.workspaceMode : "worktree",
    }, source.agentId);
    fork.permissionProfile = source.permissionProfile;
    fork.harnessId = source.harnessId;
    fork.acpMode = source.acpMode;
    fork.modelOverride = source.modelOverride;
    if (input.workspace === "same") fork.worktreeBranch = source.worktreeBranch;
    fork.carryOver = carryOverFor(source, split.before.messageIds.length > 0);
    fork.forkedFrom = this.forkRoot(source, run);
    if (input.workspace === "worktree") {
      await this.host.attachWorktree(fork, project);
      const restored = await restoreCheckpoint(fork.workingDirectory!, run.checkpointRef!);
      if (!restored.ok) throw new Error(`The worktree was created at ${fork.workingDirectory}, but its files could not be set to this turn: ${restored.detail}`);
    }
    this.repos.insertSession(fork);
    const copies: Array<{ cwd: string; from: string; to: string }> = [];
    const originals = new Map(split.before.runIds.map((id) => [id, this.repos.getRun(id)]));
    const byRef = new Map([...originals.values()].flatMap((item) => (item?.checkpointRef ? [[item.checkpointRef, item] as const] : [])));
    this.repos.copyTranscript({
      toSessionId: fork.id,
      messageIds: split.before.messageIds,
      runIds: split.before.runIds,
      workingDirectory: input.workspace === "worktree" ? fork.workingDirectory : undefined,
      checkpointRef: (ref, copyRunId) => {
        const to = `${checkpointRef(fork.id, 0)}/${copyRunId}`;
        const original = byRef.get(ref);
        const cwd = original ? this.host.cwdForRun(original) : undefined;
        if (cwd) copies.push({ cwd, from: ref, to });
        return to;
      },
    });
    // The copy owns its refs, so deleting either thread leaves the other's diffs readable.
    for (const copy of copies) {
      if (!(await copyCheckpointRef(copy.cwd, copy.from, copy.to).catch(() => false))) this.host.log(`Could not copy checkpoint ${copy.from} into a fork.`);
    }
    this.host.log(`Forked ${source.title} at a turn into ${fork.title}${input.workspace === "worktree" ? ` (${fork.worktreeBranch})` : ""}.`);
    this.host.emit("sessions-updated");
    return this.repos.getSession(fork.id) ?? fork;
  }

  /**
   * Forking a fork at a turn it copied is forking the original there: all
   * threads that share history up to that turn are one group of branches.
   */
  private forkRoot(session: Session, run: Run): { sessionId: string; runId: string } {
    let current = { session, run };
    for (let depth = 0; depth < 16; depth += 1) {
      const origin = current.session.forkedFrom;
      if (!origin || current.run.createdAt >= current.session.createdAt) break;
      const parent = this.repos.getSession(origin.sessionId);
      const match = parent && this.repos.listRuns(parent.id).find((item) => item.createdAt === current.run.createdAt && item.prompt === current.run.prompt);
      if (!parent || !match) break;
      current = { session: parent, run: match };
    }
    return { sessionId: current.session.id, runId: current.run.id };
  }

  /** Every group of branches this thread belongs to, anchored on its own turns. */
  branches(sessionId: string): ForkBranchGroup[] {
    const session = this.repos.getSession(sessionId);
    if (!session) return [];
    const sessions = this.repos.listSessions();
    const keys = new Map<string, { sessionId: string; runId: string }>();
    for (const other of sessions) {
      if (other.forkedFrom?.sessionId === session.id) keys.set(`${other.forkedFrom.sessionId}:${other.forkedFrom.runId}`, other.forkedFrom);
    }
    if (session.forkedFrom) keys.set(`${session.forkedFrom.sessionId}:${session.forkedFrom.runId}`, session.forkedFrom);
    const runs = this.repos.listRuns(session.id);
    const groups: ForkBranchGroup[] = [];
    for (const key of keys.values()) {
      const root = sessions.find((item) => item.id === key.sessionId);
      const rootRun = this.repos.getRun(key.runId);
      const forks = sessions
        .filter((item) => item.forkedFrom?.sessionId === key.sessionId && item.forkedFrom.runId === key.runId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      const members = [...(root ? [root] : []), ...forks];
      if (members.length < 2) continue;
      const anchor = session.id === key.sessionId
        ? rootRun
        : runs.find((item) => rootRun && item.createdAt === rootRun.createdAt && item.prompt === rootRun.prompt)
          ?? runs.find((item) => item.createdAt < session.createdAt);
      if (!anchor) continue;
      const branches = members.map((member): ForkBranch => {
        const original = member.id === key.sessionId;
        const since = original ? rootRun?.createdAt ?? member.createdAt : member.createdAt;
        const later = this.repos.listRuns(member.id).filter((item) => (original ? item.createdAt > since : item.createdAt >= since));
        return {
          sessionId: member.id,
          title: member.title,
          original,
          ...(original ? {} : { forkedAt: member.createdAt }),
          worktree: member.workspaceMode === "worktree" && (!root || member.workingDirectory !== root.workingDirectory || original),
          turnsSince: later.length,
          ...(later[0] ? { latestStatus: later[0].status } : {}),
          archived: member.state === "archived",
        };
      });
      groups.push({ anchorRunId: anchor.id, branches, currentIndex: members.findIndex((member) => member.id === session.id) });
    }
    return groups;
  }
}

function publicPoint(point: RestorePointRecord): RedoPoint {
  return {
    id: point.id,
    sessionId: point.sessionId,
    ...(point.targetRunId ? { targetRunId: point.targetRunId } : {}),
    scope: point.scope,
    ...(point.edit ? { edit: true } : {}),
    createdAt: point.createdAt,
    filesSaved: point.filesSaved,
    hiddenMessages: point.hiddenMessages,
  };
}
