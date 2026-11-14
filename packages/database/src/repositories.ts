import type {
  RunRating,
  ThreadGroup,
  Agent,
  ApprovalRequest,
  Artifact,
  ChannelBinding,
  ChatMessage,
  ExecutionContract,
  HarnessSessionState,
  AcpMode,
  PolicyDecision,
  PolicyRule,
  RedoPoint,
  Project,
  Run,
  RunEvent,
  Session,
  Skill,
  SkillPack,
  Workspace,
} from "@capsule/shared";
import { isHarnessId, isTurnMode, readPendingStart, TextBudget, REPLY_BYTE_LIMIT } from "@capsule/shared";

const runTurnMode = (value: unknown) => isTurnMode(value) ? value : undefined;
import type { CapsuleDatabase } from "./database.js";
import { copyTranscript, parkRows, splitTranscript, unparkRows, type CopyTranscriptOptions, type TranscriptRows, type TranscriptSplit } from "./transcript-rows.js";

/** A restore as stored: what Redo needs to put the thread back. */
export interface RestorePointRecord extends RedoPoint {
  /** Snapshot of the folder just before the restore, under the thread's checkpoint refs. */
  filesRef?: string;
  filesCwd?: string;
  parkedRows: Partial<TranscriptRows>;
  /** The agent session the restore dropped. */
  agentBefore?: Pick<Session, "openclawSessionKey" | "directSession" | "harnessState" | "carryOver">;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function optional(value: string | undefined | null): string | null {
  return value ? value : null;
}

function sessionParams(session: Session) {
  return {
    id: session.id,
    workspaceId: session.workspaceId,
    projectId: session.projectId,
    agentId: session.agentId,
    title: session.title,
    mode: session.mode,
    state: session.state,
    openclawSessionKey: session.openclawSessionKey ?? null,
    harnessId: optional(session.harnessId),
    harnessState: optional(session.harnessState),
    acpMode: optional(session.acpMode),
    permissionProfile: optional(session.permissionProfile),
    modelOverride: optional(session.modelOverride),
    directSession: session.directSession ? JSON.stringify(session.directSession) : null,
    carryOver: session.carryOver ? JSON.stringify(session.carryOver) : null,
    pendingStart: session.pendingStart ? JSON.stringify(session.pendingStart) : null,
    doneAt: session.doneAt ?? null,
    forkedFrom: session.forkedFrom ? JSON.stringify(session.forkedFrom) : null,
    groupId: session.groupId ?? null,
    origin: session.origin ? JSON.stringify(session.origin) : null,
    pinned: session.pinned ? 1 : 0,
    pinOrder: session.pinOrder ?? null,
    workingDirectory: session.workingDirectory ?? null,
    workspaceMode: session.workspaceMode ?? "local",
    worktreeBranch: session.worktreeBranch ?? null,
    turnMode: session.turnMode ?? null,
    worktreeBaseRef: session.worktreeBaseRef ?? null,
    profileId: session.profileId ?? null,
    automationId: session.automationId ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function readTags(value: string | null | undefined): string[] | undefined {
  const tags = parseJson<unknown>(value, undefined);
  return Array.isArray(tags) && tags.length ? tags.filter((tag): tag is string => typeof tag === "string") : undefined;
}

type SessionRow = Omit<Session, "directSession" | "carryOver" | "pendingStart" | "doneAt" | "forkedFrom" | "groupId" | "origin" | "pullRequest" | "paused" | "tags"> & {
  tags?: string | null;
  groupId?: string | null;
  pullRequest?: string | null;
  paused?: string | null;
  origin?: string | null;
  directSession?: string | null;
  carryOver?: string | null;
  pendingStart?: string | null;
  doneAt?: string | null;
  forkedFrom?: string | null;
};

function normalizeSession(row: SessionRow): Session {
  const harnessId = isHarnessId(row.harnessId)
    ? row.harnessId
    : isHarnessId(row.agentId)
      ? row.agentId
      : undefined;
  return {
    ...row,
    harnessId,
    harnessState: (row.harnessState || undefined) as HarnessSessionState | undefined,
    acpMode: (row.acpMode || undefined) as AcpMode | undefined,
    permissionProfile: row.permissionProfile || undefined,
    modelOverride: row.modelOverride || undefined,
    profileId: row.profileId || undefined,
    automationId: row.automationId || undefined,
    directSession: parseJson<Session["directSession"]>(row.directSession, undefined),
    carryOver: parseJson<Session["carryOver"]>(row.carryOver, undefined),
    pendingStart: readPendingStart(row.pendingStart),
    doneAt: row.doneAt || undefined,
    forkedFrom: parseJson<Session["forkedFrom"]>(row.forkedFrom, undefined),
    groupId: row.groupId || undefined,
    origin: parseJson<Session["origin"]>(row.origin, undefined),
    pullRequest: parseJson<Session["pullRequest"]>(row.pullRequest, undefined),
    paused: parseJson<Session["paused"]>(row.paused, undefined),
    tags: readTags(row.tags),
    pinned: Boolean(row.pinned),
    pinOrder: typeof row.pinOrder === "number" ? row.pinOrder : undefined,
    openclawSessionKey: row.openclawSessionKey || undefined,
    workingDirectory: row.workingDirectory || undefined,
    workspaceMode: row.workspaceMode === "worktree" ? "worktree" : "local",
    worktreeBranch: row.worktreeBranch || undefined,
    turnMode: isTurnMode(row.turnMode) ? row.turnMode : undefined,
    lastViewedAt: row.lastViewedAt || undefined,
    settledAt: row.settledAt || undefined,
    snoozedUntil: row.snoozedUntil || undefined,
    worktreeBaseRef: row.worktreeBaseRef || undefined,
  };
}

export class CapsuleRepositories {
  constructor(private readonly db: CapsuleDatabase) {}

  getSetting(key: string): string | undefined {
    const row = this.db.sqlite
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string; } | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db.sqlite
      .prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.sqlite.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  /** Keys under a prefix, e.g. every conversation's stored follow-ups. */
  listSettingKeys(prefix: string): string[] {
    const rows = this.db.sqlite
      .prepare("SELECT key FROM settings WHERE substr(key, 1, ?) = ?")
      .all(prefix.length, prefix) as Array<{ key: string }>;
    return rows.map((row) => row.key);
  }

  insertWorkspace(workspace: Workspace): void {
    this.db.sqlite
      .prepare(
        "INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (@id, @name, @createdAt, @updatedAt)",
      )
      .run(workspace);
  }

  listWorkspaces(): Workspace[] {
    return this.db.sqlite
      .prepare("SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM workspaces")
      .all() as Workspace[];
  }

  insertProject(project: Project): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO projects (
          id, workspace_id, name, description, working_directory, extra_folders, project_actions, icon_path, default_agent_id,
          default_skill_ids, default_mode, default_workspace_mode, default_worktree_base_ref, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @name, @description, @workingDirectory, @extraFolders, @actions, @iconPath, @defaultAgentId,
          @defaultSkillIds, @defaultMode, @defaultWorkspaceMode, @defaultWorktreeBaseRef, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...project,
        description: project.description ?? null,
        workingDirectory: project.workingDirectory ?? null,
        extraFolders: JSON.stringify(project.extraFolders ?? []),
        actions: JSON.stringify(project.actions ?? []),
        iconPath: project.iconPath ?? null,
        defaultAgentId: project.defaultAgentId ?? null,
        defaultWorkspaceMode: project.defaultWorkspaceMode ?? null,
        defaultWorktreeBaseRef: project.defaultWorktreeBaseRef ?? null,
        defaultSkillIds: JSON.stringify(project.defaultSkillIds),
      });
  }

  listProjects(): Project[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, description, working_directory AS workingDirectory,
                extra_folders AS extraFolders, project_actions AS actions, icon_path AS iconPath,
                default_agent_id AS defaultAgentId,
                default_skill_ids AS defaultSkillIds, default_mode AS defaultMode,
                default_workspace_mode AS defaultWorkspaceMode,
                default_worktree_base_ref AS defaultWorktreeBaseRef,
                created_at AS createdAt, updated_at AS updatedAt
         FROM projects ORDER BY sort_order IS NOT NULL, sort_order, updated_at DESC`,
      )
      .all() as Array<
      Omit<Project, "defaultSkillIds" | "extraFolders" | "actions"> & {
        defaultSkillIds: string;
        extraFolders: string;
        actions: string;
      }
    >;
    return rows.map((row) => {
      const extraFolders = parseJson<string[]>(row.extraFolders, []);
      const actions = parseJson<Project["actions"]>(row.actions, []);
      return {
        ...row,
        description: row.description || undefined,
        workingDirectory: row.workingDirectory || undefined,
        extraFolders: extraFolders.length > 0 ? extraFolders : undefined,
        actions: actions && actions.length > 0 ? actions : undefined,
        iconPath: row.iconPath || undefined,
        defaultAgentId: row.defaultAgentId || undefined,
        defaultWorkspaceMode: row.defaultWorkspaceMode || undefined,
        defaultWorktreeBaseRef: row.defaultWorktreeBaseRef || undefined,
        defaultSkillIds: parseJson<string[]>(row.defaultSkillIds, []),
      };
    });
  }

  getProject(id: string): Project | undefined {
    return this.listProjects().find((project) => project.id === id);
  }

  updateProject(project: Project): void {
    this.db.sqlite
      .prepare(
        `UPDATE projects SET name = @name, description = @description, working_directory = @workingDirectory,
         extra_folders = @extraFolders, project_actions = @actions, icon_path = @iconPath,
         default_agent_id = @defaultAgentId,
         default_skill_ids = @defaultSkillIds, default_mode = @defaultMode,
         default_workspace_mode = @defaultWorkspaceMode,
         default_worktree_base_ref = @defaultWorktreeBaseRef,
         updated_at = @updatedAt WHERE id = @id`,
      )
      .run({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        workingDirectory: project.workingDirectory ?? null,
        extraFolders: JSON.stringify(project.extraFolders ?? []),
        actions: JSON.stringify(project.actions ?? []),
        iconPath: project.iconPath ?? null,
        defaultAgentId: project.defaultAgentId ?? null,
        defaultWorkspaceMode: project.defaultWorkspaceMode ?? null,
        defaultWorktreeBaseRef: project.defaultWorktreeBaseRef ?? null,
        defaultSkillIds: JSON.stringify(project.defaultSkillIds),
        defaultMode: project.defaultMode,
        updatedAt: project.updatedAt,
      });
  }

  insertSession(session: Session): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO sessions (
          id, workspace_id, project_id, agent_id, title, mode, state,
          openclaw_session_key, harness_id, harness_state, acp_mode,
          permission_profile, model_override, pinned, pin_order, working_directory, workspace_mode,
          worktree_branch, worktree_base_ref, direct_session, carry_over, pending_start, done_at, forked_from, turn_mode, group_id, origin, profile_id, automation_id, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @projectId, @agentId, @title, @mode, @state,
          @openclawSessionKey, @harnessId, @harnessState, @acpMode,
          @permissionProfile, @modelOverride, @pinned, @pinOrder, @workingDirectory, @workspaceMode,
          @worktreeBranch, @worktreeBaseRef, @directSession, @carryOver, @pendingStart, @doneAt, @forkedFrom, @turnMode, @groupId, @origin, @profileId, @automationId, @createdAt, @updatedAt
        )`,
      )
      .run(sessionParams(session));
  }

  updateSession(session: Session): void {
    this.db.sqlite
      .prepare(
        `UPDATE sessions SET title = @title, agent_id = @agentId, mode = @mode, state = @state,
         openclaw_session_key = @openclawSessionKey, harness_id = @harnessId,
         harness_state = @harnessState, acp_mode = @acpMode,
         permission_profile = @permissionProfile, model_override = @modelOverride,
         pinned = @pinned, pin_order = @pinOrder, working_directory = @workingDirectory, workspace_mode = @workspaceMode,
         worktree_branch = @worktreeBranch, worktree_base_ref = @worktreeBaseRef, direct_session = @directSession, carry_over = @carryOver, forked_from = @forkedFrom, turn_mode = @turnMode, profile_id = @profileId, automation_id = @automationId, updated_at = @updatedAt WHERE id = @id`,
      )
      .run(sessionParams(session));
  }

  /**
   * A card's draft prompt and done mark, written on their own. Turns update
   * their thread from objects read seconds earlier; if those writes carried
   * these columns, a turn finishing could undo a card marked done meanwhile.
   */
  updateSessionBoard(session: Pick<Session, "id" | "pendingStart" | "doneAt" | "updatedAt">): void {
    this.db.sqlite
      .prepare("UPDATE sessions SET pending_start = ?, done_at = ?, updated_at = ? WHERE id = ?")
      .run(session.pendingStart ? JSON.stringify(session.pendingStart) : null, session.doneAt ?? null, session.updatedAt, session.id);
  }

  /** Written on its own: a turn finishing must not put back a reading it loaded earlier. */
  setSessionPullRequest(sessionId: string, pullRequest: Session["pullRequest"]): void {
    this.db.sqlite.prepare("UPDATE sessions SET pull_request = ? WHERE id = ?").run(pullRequest ? JSON.stringify(pullRequest) : null, sessionId);
  }

  setSessionTags(sessionId: string, tags: readonly string[]): void {
    this.db.sqlite.prepare("UPDATE sessions SET tags = ? WHERE id = ?").run(tags.length ? JSON.stringify(tags) : null, sessionId);
  }

  setSessionPaused(sessionId: string, paused: Session["paused"]): void {
    this.db.sqlite.prepare("UPDATE sessions SET paused = ? WHERE id = ?").run(paused ? JSON.stringify(paused) : null, sessionId);
  }

  /** Written once, when a comparison creates the thread; turn updates never carry it. */
  setSessionGroup(sessionId: string, groupId: string): void {
    this.db.sqlite.prepare("UPDATE sessions SET group_id = ? WHERE id = ?").run(groupId, sessionId);
  }

  insertThreadGroup(group: ThreadGroup): void {
    this.db.sqlite
      .prepare("INSERT INTO thread_groups (id, project_id, kind, prompt, candidates, winner_session_id, decided_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(group.id, group.projectId, group.kind, group.prompt, JSON.stringify(group.candidates), group.winnerSessionId ?? null, group.decidedAt ?? null, group.createdAt);
  }

  listThreadGroups(): ThreadGroup[] {
    const rows = this.db.sqlite
      .prepare(`SELECT id, project_id AS projectId, kind, prompt, candidates, winner_session_id AS winnerSessionId, decided_at AS decidedAt, created_at AS createdAt
        FROM thread_groups ORDER BY created_at DESC`)
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) => ({
      id: row.id!,
      projectId: row.projectId!,
      kind: "best-of-n",
      prompt: row.prompt!,
      candidates: parseJson<ThreadGroup["candidates"]>(row.candidates, []),
      createdAt: row.createdAt!,
      ...(row.winnerSessionId ? { winnerSessionId: row.winnerSessionId } : {}),
      ...(row.decidedAt ? { decidedAt: row.decidedAt } : {}),
    }));
  }

  getThreadGroup(id: string): ThreadGroup | undefined {
    return this.listThreadGroups().find((group) => group.id === id);
  }

  /** The kept candidate, or none when the keep was undone. */
  setThreadGroupWinner(id: string, winnerSessionId: string | undefined, decidedAt: string | undefined): void {
    this.db.sqlite
      .prepare("UPDATE thread_groups SET winner_session_id = ?, decided_at = ? WHERE id = ?")
      .run(winnerSessionId ?? null, decidedAt ?? null, id);
  }

  deleteThreadGroup(id: string): void {
    this.db.sqlite.prepare("DELETE FROM thread_groups WHERE id = ?").run(id);
  }

  setRunRating(rating: RunRating): void {
    this.db.sqlite
      .prepare(`INSERT INTO run_ratings (run_id, session_id, harness_id, model, value, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET value = excluded.value, harness_id = excluded.harness_id, model = excluded.model, created_at = excluded.created_at`)
      .run(rating.runId, rating.sessionId, rating.harnessId, rating.model, rating.value, rating.createdAt);
  }

  clearRunRating(runId: string): void {
    this.db.sqlite.prepare("DELETE FROM run_ratings WHERE run_id = ?").run(runId);
  }

  listRunRatings(sessionId?: string): RunRating[] {
    const columns = "run_id AS runId, session_id AS sessionId, harness_id AS harnessId, model, value, created_at AS createdAt";
    const rows = (sessionId
      ? this.db.sqlite.prepare(`SELECT ${columns} FROM run_ratings WHERE session_id = ?`).all(sessionId)
      : this.db.sqlite.prepare(`SELECT ${columns} FROM run_ratings`).all()) as RunRating[];
    return rows.filter((row) => row.value === 1 || row.value === -1);
  }

  deleteSession(id: string): void {
    const runIds = (
      this.db.sqlite.prepare("SELECT id FROM runs WHERE session_id = ?").all(id) as Array<{ id: string; }>
    ).map((row) => row.id);
    this.deleteRuns(runIds);
    this.db.sqlite.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM artifacts WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM restore_points WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  /** Where a thread splits at a message; see splitTranscript. */
  splitTranscript(sessionId: string, cutMessageId?: string): TranscriptSplit {
    return splitTranscript(this.db.sqlite, sessionId, cutMessageId);
  }

  /** Take turns out of a thread whole, for a restore point to keep. */
  parkTranscript(messageIds: string[], runIds: string[]): TranscriptRows {
    return parkRows(this.db.sqlite, messageIds, runIds);
  }

  unparkTranscript(rows: Partial<TranscriptRows>): void {
    unparkRows(this.db.sqlite, rows);
  }

  copyTranscript(options: CopyTranscriptOptions): Map<string, string> {
    return copyTranscript(this.db.sqlite, options);
  }

  insertRestorePoint(point: RestorePointRecord): void {
    this.db.sqlite.prepare(`INSERT INTO restore_points (id, session_id, target_run_id, scope, edit, files_ref, files_cwd, parked_rows, hidden_messages, agent_before, created_at)
      VALUES (@id, @sessionId, @targetRunId, @scope, @edit, @filesRef, @filesCwd, @parkedRows, @hiddenMessages, @agentBefore, @createdAt)`).run({
      id: point.id,
      sessionId: point.sessionId,
      targetRunId: point.targetRunId ?? null,
      scope: point.scope,
      edit: point.edit ? 1 : 0,
      filesRef: point.filesRef ?? null,
      filesCwd: point.filesCwd ?? null,
      parkedRows: JSON.stringify(point.parkedRows),
      hiddenMessages: point.hiddenMessages,
      agentBefore: point.agentBefore ? JSON.stringify(point.agentBefore) : null,
      createdAt: point.createdAt,
    });
  }

  /** Newest first. Rows are parsed only for the caller that asks for them. */
  listRestorePoints(sessionId: string): RestorePointRecord[] {
    const rows = this.db.sqlite.prepare(`SELECT id, session_id AS sessionId, target_run_id AS targetRunId, scope, edit, files_ref AS filesRef, files_cwd AS filesCwd,
      parked_rows AS parkedRows, hidden_messages AS hiddenMessages, agent_before AS agentBefore, created_at AS createdAt
      FROM restore_points WHERE session_id = ? ORDER BY created_at DESC, rowid DESC`).all(sessionId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      sessionId: String(row.sessionId),
      targetRunId: typeof row.targetRunId === "string" ? row.targetRunId : undefined,
      scope: row.scope as RestorePointRecord["scope"],
      edit: Boolean(row.edit),
      filesRef: typeof row.filesRef === "string" ? row.filesRef : undefined,
      filesCwd: typeof row.filesCwd === "string" ? row.filesCwd : undefined,
      filesSaved: typeof row.filesRef === "string",
      parkedRows: parseJson<Partial<TranscriptRows>>(row.parkedRows as string, {}),
      hiddenMessages: Number(row.hiddenMessages) || 0,
      agentBefore: parseJson<RestorePointRecord["agentBefore"]>(row.agentBefore as string | null, undefined),
      createdAt: String(row.createdAt),
    }));
  }

  deleteRestorePoint(id: string): void {
    this.db.sqlite.prepare("DELETE FROM restore_points WHERE id = ?").run(id);
  }

  /** Whether anything was written to the thread after a moment: a new turn, a steer, a notice. */
  hasMessagesSince(sessionId: string, since: string): boolean {
    return Boolean(this.db.sqlite.prepare("SELECT 1 FROM messages WHERE session_id = ? AND created_at > ? LIMIT 1").get(sessionId, since)
      || this.db.sqlite.prepare("SELECT 1 FROM runs WHERE session_id = ? AND created_at > ? LIMIT 1").get(sessionId, since));
  }

  deleteProject(id: string): void {
    const sessions = this.listSessions(id);
    for (const session of sessions) this.deleteSession(session.id);
    this.db.sqlite.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  private deleteRuns(runIds: string[]): void {
    for (const runId of runIds) {
      this.db.sqlite.prepare("DELETE FROM run_events WHERE run_id = ?").run(runId);
      this.db.sqlite.prepare("DELETE FROM artifacts WHERE run_id = ?").run(runId);
      this.db.sqlite.prepare("DELETE FROM approvals WHERE run_id = ?").run(runId);
      this.db.sqlite.prepare("DELETE FROM policy_decisions WHERE run_id = ?").run(runId);
      this.db.sqlite.prepare("DELETE FROM contracts WHERE run_id = ?").run(runId);
      this.db.sqlite.prepare("DELETE FROM runs WHERE id = ?").run(runId);
    }
  }

  listSessions(projectId?: string): Session[] {
    const columns = `id, workspace_id AS workspaceId, project_id AS projectId, agent_id AS agentId,
                title, mode, state, openclaw_session_key AS openclawSessionKey,
                harness_id AS harnessId, harness_state AS harnessState, acp_mode AS acpMode,
                permission_profile AS permissionProfile, model_override AS modelOverride,
                pinned, pin_order AS pinOrder, working_directory AS workingDirectory, workspace_mode AS workspaceMode,
                worktree_branch AS worktreeBranch, worktree_base_ref AS worktreeBaseRef, direct_session AS directSession, carry_over AS carryOver,
                pending_start AS pendingStart, done_at AS doneAt, forked_from AS forkedFrom, turn_mode AS turnMode, group_id AS groupId, origin, pull_request AS pullRequest, paused, tags,
                profile_id AS profileId, automation_id AS automationId, created_at AS createdAt, updated_at AS updatedAt,
                last_viewed_at AS lastViewedAt, settled_at AS settledAt, snoozed_until AS snoozedUntil`;
    const sql = projectId
      ? `SELECT ${columns} FROM sessions WHERE project_id = ?
         ORDER BY pinned DESC, COALESCE(pin_order, 2147483647) ASC, updated_at DESC`
      : `SELECT ${columns} FROM sessions
         ORDER BY pinned DESC, COALESCE(pin_order, 2147483647) ASC, updated_at DESC`;
    const rows = (
      projectId ? this.db.sqlite.prepare(sql).all(projectId) : this.db.sqlite.prepare(sql).all()
    ) as SessionRow[];
    return rows.map(normalizeSession);
  }

  /**
   * Triage is the person's bookkeeping, written apart from the row so that
   * reading a thread never bumps `updated_at` and reorders the sidebar.
   */
  updateSessionTriage(session: Pick<Session, "id" | "lastViewedAt" | "settledAt" | "snoozedUntil">): void {
    this.db.sqlite
      .prepare("UPDATE sessions SET last_viewed_at = ?, settled_at = ?, snoozed_until = ? WHERE id = ?")
      .run(session.lastViewedAt ?? null, session.settledAt ?? null, session.snoozedUntil ?? null, session.id);
  }

  /** Places projects in this order; ones not named keep no position and list first. */
  setProjectOrder(orderedIds: readonly string[]): void {
    const update = this.db.sqlite.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
    this.db.sqlite.transaction(() => orderedIds.forEach((id, index) => update.run(index, id)))();
  }

  getSession(id: string): Session | undefined {
    return this.listSessions().find((session) => session.id === id);
  }

  insertMessage(message: ChatMessage): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, attachments, kind, run_id, created_at)
         VALUES (@id, @sessionId, @role, @content, @attachments, @kind, @runId, @createdAt)`,
      )
      .run({
        ...message,
        attachments: JSON.stringify(message.attachments ?? []),
        kind: message.kind ?? null,
        runId: message.runId ?? null,
      });
  }

  getMessageAttachments(messageId: string): NonNullable<ChatMessage["attachments"]> {
    const row = this.db.sqlite.prepare("SELECT attachments FROM messages WHERE id = ?").get(messageId) as { attachments: string } | undefined;
    return row ? parseJson(row.attachments, []) : [];
  }

  /** Title regeneration needs one bounded seed, not the entire transcript. */
  firstUserTitleSeed(sessionId: string): string | undefined {
    const row = this.db.sqlite.prepare(`
      SELECT substr(content, 1, 4096) AS content,
             CASE WHEN json_valid(attachments) THEN json_extract(attachments, '$[0].name') END AS attachmentName
      FROM messages WHERE session_id = ? AND role = 'user'
      ORDER BY created_at ASC, id ASC LIMIT 1
    `).get(sessionId) as { content: string; attachmentName: string | null } | undefined;
    return row ? row.content.trim() || row.attachmentName || "New conversation" : undefined;
  }

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, role, content, attachments, kind,
                run_id AS runId, created_at AS createdAt
         FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as Array<Omit<ChatMessage, "attachments"> & { attachments: string; }>;
    return rows.map((row) => {
      const attachments = parseJson<NonNullable<ChatMessage["attachments"]>>(row.attachments, []);
      return { ...row, attachments: attachments.length > 0 ? attachments : undefined };
    });
  }

  /*
   * Keyset pagination over (created_at, id). OFFSET would re-scan the whole
   * conversation for every page, and created_at alone is not unique — two
   * messages written in the same millisecond would make a cursor skip or
   * repeat rows. The id breaks that tie.
   */
  listMessagesBefore(
    sessionId: string,
    limit: number,
    before?: { createdAt: string; id: string; },
  ): ChatMessage[] {
    const columns = `id, session_id AS sessionId, role,
                     substr(content, 1, 65536) AS content, length(content) > 65536 AS contentTruncated,
                     attachments, kind,
                     run_id AS runId, created_at AS createdAt`;
    type MessagePageRow = Omit<ChatMessage, "attachments" | "contentTruncated"> & {
      attachments: string;
      contentTruncated: number;
    };
    const rows = before
      ? (this.db.sqlite
          .prepare(
            `SELECT ${columns} FROM messages
             WHERE session_id = @sessionId
               AND (created_at < @createdAt OR (created_at = @createdAt AND id < @id))
             ORDER BY created_at DESC, id DESC LIMIT @limit`,
          )
          .all({ sessionId, createdAt: before.createdAt, id: before.id, limit }) as MessagePageRow[])
      : (this.db.sqlite
          .prepare(
            `SELECT ${columns} FROM messages WHERE session_id = @sessionId
             ORDER BY created_at DESC, id DESC LIMIT @limit`,
          )
          .all({ sessionId, limit }) as MessagePageRow[]);
    // Query is newest-first so LIMIT takes the right end; callers want reading order.
    return rows.reverse().map((row) => {
      const attachments = parseJson<NonNullable<ChatMessage["attachments"]>>(row.attachments, []);
      // SQLite returns 0/1, not booleans. Normalize before crossing IPC so a
      // false display flag cannot become a visible "0" in a React condition.
      return { ...row, contentTruncated: Boolean(row.contentTruncated), attachments: attachments.length > 0 ? attachments : undefined };
    });
  }

  searchMessages(needle: string, limit = 20): Array<{
    id: string;
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    role: ChatMessage["role"];
    excerpt: string;
  }> {
    const rows = this.db.sqlite
      .prepare(
        `SELECT m.id AS id, m.session_id AS sessionId, m.role AS role, m.content AS content,
                s.project_id AS projectId, s.title AS sessionTitle
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE instr(lower(m.content), ?) > 0
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(needle, limit) as Array<{
      id: string;
      sessionId: string;
      role: ChatMessage["role"];
      content: string;
      projectId: string;
      sessionTitle: string;
    }>;
    return rows.map((row) => {
      const index = row.content.toLowerCase().indexOf(needle);
      const start = Math.max(0, index - 24);
      const excerpt = `${start > 0 ? "…" : ""}${row.content.slice(start, start + 80).replace(/\s+/g, " ")}`;
      return {
        id: row.id,
        sessionId: row.sessionId,
        projectId: row.projectId,
        sessionTitle: row.sessionTitle,
        role: row.role,
        excerpt,
      };
    });
  }

  upsertAgent(agent: Agent): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO agents (
          id, name, description, runtime, model, workspace, skills, tools, permissions,
          status, kind, recent_run_ids, updated_at
        ) VALUES (
          @id, @name, @description, @runtime, @model, @workspace, @skills, @tools, @permissions,
          @status, @kind, @recentRunIds, @updatedAt
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          runtime = excluded.runtime,
          model = excluded.model,
          workspace = excluded.workspace,
          skills = excluded.skills,
          tools = excluded.tools,
          permissions = excluded.permissions,
          status = excluded.status,
          kind = excluded.kind,
          recent_run_ids = excluded.recent_run_ids,
          updated_at = excluded.updated_at`,
      )
      .run({
        ...agent,
        model: agent.model ?? null,
        workspace: agent.workspace ?? null,
        skills: JSON.stringify(agent.skills),
        tools: JSON.stringify(agent.tools),
        permissions: JSON.stringify(agent.permissions),
        recentRunIds: JSON.stringify(agent.recentRunIds),
        updatedAt: new Date().toISOString(),
      });
  }

  listAgents(): Agent[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, name, description, runtime, model, workspace, skills, tools, permissions,
                status, kind, recent_run_ids AS recentRunIds FROM agents ORDER BY name`,
      )
      .all() as Array<
      Omit<Agent, "skills" | "tools" | "permissions" | "recentRunIds"> & {
        skills: string;
        tools: string;
        permissions: string;
        recentRunIds: string;
      }
    >;
    return rows.map((row) => ({
      ...row,
      skills: parseJson<string[]>(row.skills, []),
      tools: parseJson<string[]>(row.tools, []),
      permissions: parseJson(row.permissions, {}),
      recentRunIds: parseJson<string[]>(row.recentRunIds, []),
    }));
  }

  upsertSkill(skill: Skill): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO skills (
          id, name, version, description, source, status, requirements, permissions, validation,
          pack_id, pack_name, content, installs, tags, author, url
        ) VALUES (
          @id, @name, @version, @description, @source, @status, @requirements, @permissions, @validation,
          @packId, @packName, @content, @installs, @tags, @author, @url
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          description = excluded.description,
          source = excluded.source,
          status = excluded.status,
          requirements = excluded.requirements,
          permissions = excluded.permissions,
          validation = excluded.validation,
          pack_id = excluded.pack_id,
          pack_name = excluded.pack_name,
          content = excluded.content,
          installs = excluded.installs,
          tags = excluded.tags,
          author = excluded.author,
          url = excluded.url`,
      )
      .run({
        ...skill,
        // The original schema requires TEXT; an empty value represents an
        // undeclared version without inventing a release number.
        version: skill.version ?? "",
        requirements: JSON.stringify(skill.requirements),
        permissions: JSON.stringify(skill.permissions),
        validation: skill.validation ?? null,
        packId: skill.packId ?? null,
        packName: skill.packName ?? null,
        content: skill.content ?? null,
        installs: skill.installs ?? null,
        tags: JSON.stringify(skill.tags ?? []),
        author: skill.author ?? null,
        url: skill.url ?? null,
      });
  }

  listSkills(): Skill[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, name, version, description, source, status, requirements, permissions, validation,
                pack_id AS packId, pack_name AS packName, content, installs, tags, author, url
         FROM skills ORDER BY name`,
      )
      .all() as Array<
      Omit<Skill, "requirements" | "permissions" | "tags"> & {
        requirements: string;
        permissions: string;
        tags: string;
      }
    >;
    return rows.map((row) => ({
      ...row,
      version: row.version || undefined,
      requirements: parseJson<string[]>(row.requirements, []),
      permissions: parseJson(row.permissions, {}),
      tags: parseJson<string[]>(row.tags, []),
    }));
  }

  getSkill(id: string): Skill | undefined {
    return this.listSkills().find((skill) => skill.id === id);
  }

  deleteSkill(id: string): void {
    this.db.sqlite.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
  }

  upsertSkillPack(pack: SkillPack): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO skill_packs (
          id, name, description, author, url, install_command, tags, skill_count, created_at
        ) VALUES (
          @id, @name, @description, @author, @url, @installCommand, @tags, @skillCount, @createdAt
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          author = excluded.author,
          url = excluded.url,
          install_command = excluded.install_command,
          tags = excluded.tags,
          skill_count = excluded.skill_count`,
      )
      .run({
        ...pack,
        author: pack.author ?? null,
        url: pack.url ?? null,
        installCommand: pack.installCommand ?? null,
        tags: JSON.stringify(pack.tags ?? []),
        skillCount: pack.skillCount ?? 0,
        createdAt: pack.createdAt ?? new Date().toISOString(),
      });
  }

  listSkillPacks(): SkillPack[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, name, description, author, url, install_command AS installCommand, tags,
                skill_count AS skillCount, created_at AS createdAt
         FROM skill_packs ORDER BY name`,
      )
      .all() as Array<Omit<SkillPack, "tags"> & { tags: string; }>;
    return rows.map((row) => ({
      ...row,
      tags: parseJson<string[]>(row.tags, []),
    }));
  }

  getSkillPack(id: string): SkillPack | undefined {
    return this.listSkillPacks().find((pack) => pack.id === id);
  }

  deleteSkillPack(id: string): void {
    this.db.sqlite.prepare(`DELETE FROM skill_packs WHERE id = ?`).run(id);
  }

  insertRun(run: Run): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO runs (
          id, session_id, project_id, agent_id, skill_id, contract_id, status, prompt, result,
          error, openclaw_run_id, checkpoint_ref, working_directory, revision, verification, turn_mode, created_at, updated_at, completed_at
        ) VALUES (
          @id, @sessionId, @projectId, @agentId, @skillId, @contractId, @status, @prompt, @result,
          @error, @openclawRunId, @checkpointRef, @workingDirectory, @revision, @verification, @turnMode, @createdAt, @updatedAt, @completedAt
        )`,
      )
      .run({
        ...run,
        skillId: run.skillId ?? null,
        contractId: run.contractId ?? null,
        result: run.result ?? null,
        error: run.error ?? null,
        openclawRunId: run.openclawRunId ?? null,
        checkpointRef: run.checkpointRef ?? null,
        workingDirectory: run.workingDirectory ?? null,
        revision: run.revision ? JSON.stringify(run.revision) : null,
        verification: run.verification ? JSON.stringify(run.verification) : null,
        turnMode: run.turnMode ?? null,
        completedAt: run.completedAt ?? null,
      });
  }

  updateRun(run: Run): void {
    this.db.sqlite
      .prepare(
        `UPDATE runs SET status = @status, result = @result, error = @error,
         openclaw_run_id = @openclawRunId, checkpoint_ref = @checkpointRef,
         working_directory = @workingDirectory, revision = @revision, verification = @verification,
         updated_at = @updatedAt, completed_at = @completedAt,
         contract_id = @contractId WHERE id = @id`,
      )
      .run({
        id: run.id,
        status: run.status,
        result: run.result ?? null,
        error: run.error ?? null,
        openclawRunId: run.openclawRunId ?? null,
        checkpointRef: run.checkpointRef ?? null,
        workingDirectory: run.workingDirectory ?? null,
        revision: run.revision ? JSON.stringify(run.revision) : null,
        verification: run.verification ? JSON.stringify(run.verification) : null,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt ?? null,
        contractId: run.contractId ?? null,
      });
  }

  getRun(id: string): Run | undefined {
    const row = this.db.sqlite.prepare(
      `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
              skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
              openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef, turn_mode AS turnMode,
              working_directory AS workingDirectory, revision, verification,
              created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
       FROM runs WHERE id = ?`,
    ).get(id) as (Omit<Run, "revision" | "verification"> & { revision: string | null; verification: string | null }) | undefined;
    return row ? { ...row, turnMode: runTurnMode(row.turnMode), revision: row.revision ? JSON.parse(row.revision) : undefined, verification: row.verification ? JSON.parse(row.verification) : undefined } : undefined;
  }

  getRunProgress(id: string): Partial<Run> | undefined {
    return this.db.sqlite.prepare(`SELECT id, status, completed_at AS completedAt
      FROM runs WHERE id = ?`).get(id) as Partial<Run> | undefined;
  }

  findReplyRun(sessionId: string, snapshotAt?: string): Run | undefined {
    const condition = snapshotAt ? "created_at <= ?" : "status IN ('queued', 'running', 'waiting', 'approval_required')";
    const row = this.db.sqlite.prepare(`SELECT id FROM runs WHERE session_id = ? AND ${condition}
      ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(...(snapshotAt ? [sessionId, snapshotAt] : [sessionId])) as { id: string } | undefined;
    return row ? this.getRun(row.id) : undefined;
  }

  listRunPage(query: import("@capsule/shared").RunHistoryQuery = {}): import("@capsule/shared").RunHistoryPage {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 200);
    const filters: string[] = [];
    const values: Array<string | number> = [];
    if (query.sessionId) { filters.push("session_id = ?"); values.push(query.sessionId); }
    if (query.projectId) { filters.push("project_id = ?"); values.push(query.projectId); }
    if (query.before) {
      filters.push("(created_at, id) < (?, ?)");
      values.push(query.before.createdAt, query.before.id);
    }
    const rows = this.db.sqlite.prepare(`
      SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
             skill_id AS skillId, contract_id AS contractId, status,
             substr(prompt, 1, 512) AS prompt, substr(error, 1, 2048) AS error,
             length(trim(result)) > 0 AS hasResult,
             openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef, turn_mode AS turnMode,
             working_directory AS workingDirectory, revision, verification,
             created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
      FROM runs ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(...values, limit + 1) as Array<Omit<Run, "revision" | "verification" | "hasResult"> & {
      revision: string | null; verification: string | null; hasResult: number | null;
    }>;
    const runs = rows.slice(0, limit).map((row) => ({ ...row, hasResult: Boolean(row.hasResult), turnMode: runTurnMode(row.turnMode),
      revision: row.revision ? JSON.parse(row.revision) : undefined,
      verification: row.verification ? JSON.parse(row.verification) : undefined,
    }));
    const last = runs.at(-1);
    return { runs, hasMore: rows.length > limit, ...(last ? { before: { createdAt: last.createdAt, id: last.id } } : {}) };
  }

  /** Ask SQL about a duplicate instead of loading a whole conversation to JS. */
  hasRecordedReply(sessionId: string, content: string, runId?: string): boolean {
    const scope = runId ? "run_id = ?" : `created_at >= coalesce((
      SELECT max(created_at) FROM messages WHERE session_id = ? AND role = 'user'
    ), '')`;
    return Boolean(this.db.sqlite.prepare(`SELECT 1 FROM messages
      WHERE session_id = ? AND role = 'assistant' AND content = ? AND ${scope} LIMIT 1`
    ).get(sessionId, content, runId ?? sessionId));
  }

  /** Read just this turn's prose; even oversized legacy rows have a byte cap. */
  readReplyText(sessionId: string, runId: string, since?: string): string {
    const scope = since ? "(run_id = ? OR created_at >= ?)" : "run_id = ?";
    const rows = this.db.sqlite.prepare(`SELECT substr(content, 1, ?) AS content FROM messages
      WHERE session_id = ? AND role = 'assistant' AND ${scope}
      ORDER BY created_at, rowid`).iterate(REPLY_BYTE_LIMIT + 1, sessionId, runId, ...(since ? [since] : []));
    const budget = new TextBudget();
    for (const row of rows) {
      const content = (row as { content: string }).content;
      budget.append("reply", `${budget.sizeOf("reply") ? "\n\n" : ""}${content}`);
    }
    return budget.take("reply");
  }

  /** Read one checkpoint identity, never the thread's accumulated prompt/results. */
  previousCheckpoint(runId: string): string | undefined {
    const row = this.db.sqlite.prepare(`SELECT older.checkpoint_ref AS ref
      FROM runs current JOIN runs older ON older.session_id = current.session_id
        AND older.working_directory IS current.working_directory
      WHERE current.id = ? AND older.checkpoint_ref IS NOT NULL
        AND (older.created_at < current.created_at
          OR (older.created_at = current.created_at AND older.rowid < current.rowid))
      ORDER BY older.created_at DESC, older.rowid DESC LIMIT 1`).get(runId) as { ref: string } | undefined;
    return row?.ref;
  }

  listRuns(sessionId?: string): Run[] {
    const sql = sessionId
      ? `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef, turn_mode AS turnMode,
                working_directory AS workingDirectory, revision, verification,
                created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs WHERE session_id = ? ORDER BY created_at DESC`
      : `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef, turn_mode AS turnMode,
                working_directory AS workingDirectory, revision, verification,
                created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs ORDER BY created_at DESC`;
    const rows = (sessionId
      ? this.db.sqlite.prepare(sql).all(sessionId)
      : this.db.sqlite.prepare(sql).all()) as Array<Omit<Run, "revision" | "verification"> & { revision: string | null; verification: string | null; }>;
    return rows.map((row) => ({ ...row, turnMode: runTurnMode(row.turnMode), revision: row.revision ? JSON.parse(row.revision) : undefined, verification: row.verification ? JSON.parse(row.verification) : undefined }));
  }

  /** One indexed lookup per visible thread, without loading prompts or result JSON. */
  listLatestRuns(): Run[] {
    const rows = this.db.sqlite.prepare(`
      SELECT r.id, r.session_id AS sessionId, r.project_id AS projectId, r.agent_id AS agentId,
             r.status, '' AS prompt, substr(r.error, 1, 2048) AS error,
             length(trim(r.result)) > 0 AS hasResult,
             r.created_at AS createdAt, r.updated_at AS updatedAt, r.completed_at AS completedAt
      FROM sessions s JOIN runs r ON r.rowid = (
        SELECT rowid FROM runs WHERE session_id = s.id ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) WHERE s.state != 'archived'
    `).all() as Array<Omit<Run, "hasResult"> & { hasResult: number | null }>;
    return rows.map((row) => ({ ...row, hasResult: Boolean(row.hasResult) }));
  }

  listLatestRunStates(): Array<Pick<Run, "id" | "sessionId" | "status" | "createdAt" | "updatedAt" | "completedAt">> {
    return this.db.sqlite.prepare(`
      SELECT r.id, r.session_id AS sessionId, r.status, r.created_at AS createdAt,
             r.updated_at AS updatedAt, r.completed_at AS completedAt
      FROM sessions s JOIN runs r ON r.rowid = (
        SELECT rowid FROM runs WHERE session_id = s.id
        ORDER BY created_at DESC, rowid DESC LIMIT 1
      ) WHERE s.state != 'archived'
    `).all() as Array<Pick<Run, "id" | "sessionId" | "status" | "createdAt" | "updatedAt" | "completedAt">>;
  }

  insertRunEvent(event: RunEvent): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO run_events (id, run_id, timestamp, type, message, data)
         VALUES (@id, @runId, @timestamp, @type, @message, @data)`,
      )
      .run({
        ...event,
        data: event.data ? JSON.stringify(event.data) : null,
      });
  }

  listRunEvents(runId: string): RunEvent[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, run_id AS runId, timestamp, type, message, data
         FROM run_events WHERE run_id = ? ORDER BY timestamp ASC, rowid ASC`,
      )
      .all(runId) as Array<Omit<RunEvent, "data"> & { data: string | null; }>;
    return rows.map((row) => ({
      ...row,
      data: parseJson(row.data, undefined),
    }));
  }

  listRunEventPage(runId: string, limit = 200, before?: RunEventCursor): RunEventPage {
    const size = Math.min(200, Math.max(1, Math.trunc(limit) || 200));
    const rows = this.db.sqlite.prepare(`
      SELECT id, run_id AS runId, timestamp, type,
        substr(message, 1, 8192) AS message,
        CASE WHEN length(data) > 32768 THEN '{"payloadTruncated":true}' ELSE data END AS data,
        length(message) > 8192 AS clipped
      FROM run_events WHERE run_id = ?
      ${before ? "AND (timestamp < ? OR (timestamp = ? AND rowid < (SELECT rowid FROM run_events WHERE id = ?)))" : ""}
      ORDER BY timestamp DESC, rowid DESC LIMIT ?
    `).all(runId, ...(before ? [before.timestamp, before.timestamp, before.id] : []), size + 1) as Array<Omit<RunEvent, "data"> & { data: string | null; clipped: number }>;
    const events = boundRunEvents(rows.slice(0, size).reverse().map(({ data, clipped, ...row }) => compactRunEvent({
      ...row, data: { ...parseJson(data, {}), ...(clipped ? { payloadTruncated: true } : {}) },
    })));
    const hasMore = rows.length > events.length;
    const first = events[0];
    return { events, hasMore, ...(hasMore && first ? { before: { timestamp: first.timestamp, id: first.id } } : {}) };
  }

  insertContract(contract: ExecutionContract): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO contracts (id, run_id, required, forbidden, human_summary, created_at)
         VALUES (@id, @runId, @required, @forbidden, @humanSummary, @createdAt)`,
      )
      .run({
        id: contract.id,
        runId: contract.runId ?? null,
        required: JSON.stringify(contract.required),
        forbidden: JSON.stringify(contract.forbidden),
        humanSummary: contract.humanSummary,
        createdAt: new Date().toISOString(),
      });
  }

  getContract(id: string): ExecutionContract | undefined {
    const row = this.db.sqlite
      .prepare(
        `SELECT id, run_id AS runId, required, forbidden, human_summary AS humanSummary
         FROM contracts WHERE id = ?`,
      )
      .get(id) as
      | (Omit<ExecutionContract, "required" | "forbidden"> & {
          required: string;
          forbidden: string;
        })
      | undefined;
    if (!row) return undefined;
    return {
      ...row,
      required: parseJson(row.required, []),
      forbidden: parseJson(row.forbidden, []),
    };
  }

  insertPolicy(rule: PolicyRule): void {
    this.upsertPolicy(rule);
  }

  upsertPolicy(rule: PolicyRule): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO policies (id, scope, scope_id, resource, action, decision)
         VALUES (@id, @scope, @scopeId, @resource, @action, @decision)
         ON CONFLICT(id) DO UPDATE SET
           scope = excluded.scope,
           scope_id = excluded.scope_id,
           resource = excluded.resource,
           action = excluded.action,
           decision = excluded.decision`,
      )
      .run({ ...rule, scopeId: rule.scopeId ?? null });
  }

  listPolicies(): PolicyRule[] {
    return this.db.sqlite
      .prepare(
        `SELECT id, scope, scope_id AS scopeId, resource, action, decision FROM policies`,
      )
      .all() as PolicyRule[];
  }

  insertPolicyDecision(decision: PolicyDecision): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO policy_decisions (
          id, run_id, rule_id, resource, action, target, decision, reason, created_at
        ) VALUES (
          @id, @runId, @ruleId, @resource, @action, @target, @decision, @reason, @createdAt
        )`,
      )
      .run({ ...decision, ruleId: decision.ruleId ?? null });
  }

  insertApproval(approval: ApprovalRequest): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO approvals (
          id, run_id, agent_id, agent_name, action, target, reason, status, created_at, resolved_at, details
        ) VALUES (
          @id, @runId, @agentId, @agentName, @action, @target, @reason, @status, @createdAt, @resolvedAt, @details
        )`,
      )
      .run({ ...approval, resolvedAt: approval.resolvedAt ?? null, details: approval.details ? JSON.stringify(approval.details) : null });
  }

  updateApproval(approval: ApprovalRequest): void {
    this.db.sqlite
      .prepare(
        "UPDATE approvals SET status = @status, resolved_at = @resolvedAt WHERE id = @id",
      )
      .run({
        id: approval.id,
        status: approval.status,
        resolvedAt: approval.resolvedAt ?? null,
      });
  }

  listApprovals(status?: ApprovalRequest["status"]): ApprovalRequest[] {
    const sql = status
      ? `SELECT id, run_id AS runId, agent_id AS agentId, agent_name AS agentName, action, target,
                reason, status, created_at AS createdAt, resolved_at AS resolvedAt, details
         FROM approvals WHERE status = ? ORDER BY created_at DESC`
      : `SELECT id, run_id AS runId, agent_id AS agentId, agent_name AS agentName, action, target,
                reason, status, created_at AS createdAt, resolved_at AS resolvedAt, details
         FROM approvals ORDER BY created_at DESC`;
    const rows = (status
      ? this.db.sqlite.prepare(sql).all(status)
      : this.db.sqlite.prepare(sql).all()) as Array<Omit<ApprovalRequest, "details"> & { details: string | null }>;
    return rows.map(({ details, ...row }) => ({ ...row, ...(details ? { details: JSON.parse(details) as ApprovalRequest["details"] } : {}) }));
  }

  insertArtifact(artifact: Artifact): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO artifacts (
          id, workspace_id, project_id, session_id, run_id, agent_id, kind, title, path,
          mime_type, content, created_at
        ) VALUES (
          @id, @workspaceId, @projectId, @sessionId, @runId, @agentId, @kind, @title, @path,
          @mimeType, @content, @createdAt
        )`,
      )
      .run({
        ...artifact,
        path: artifact.path ?? null,
        mimeType: artifact.mimeType ?? null,
        content: artifact.content ?? null,
      });
  }

  listArtifacts(runId?: string): Artifact[] {
    const sql = runId
      ? `SELECT id, workspace_id AS workspaceId, project_id AS projectId, session_id AS sessionId,
                run_id AS runId, agent_id AS agentId, kind, title, path, mime_type AS mimeType,
                content, created_at AS createdAt FROM artifacts WHERE run_id = ? ORDER BY created_at DESC`
      : `SELECT id, workspace_id AS workspaceId, project_id AS projectId, session_id AS sessionId,
                run_id AS runId, agent_id AS agentId, kind, title, path, mime_type AS mimeType,
                content, created_at AS createdAt FROM artifacts ORDER BY created_at DESC`;
    return (runId
      ? this.db.sqlite.prepare(sql).all(runId)
      : this.db.sqlite.prepare(sql).all()) as Artifact[];
  }

  upsertChannelBinding(binding: ChannelBinding): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO channel_bindings (
          id, channel, channel_id, display_name, room, thread, session_id, run_id, sender, status
        ) VALUES (
          @id, @channel, @channelId, @displayName, @room, @thread, @sessionId, @runId, @sender, @status
        ) ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          room = excluded.room,
          thread = excluded.thread,
          session_id = excluded.session_id,
          run_id = excluded.run_id,
          sender = excluded.sender,
          status = excluded.status`,
      )
      .run({
        ...binding,
        room: binding.room ?? null,
        thread: binding.thread ?? null,
        sessionId: binding.sessionId ?? null,
        runId: binding.runId ?? null,
        sender: binding.sender ?? null,
      });
  }

  listChannelBindings(): ChannelBinding[] {
    return this.db.sqlite
      .prepare(
        `SELECT id, channel, channel_id AS channelId, display_name AS displayName, room, thread,
                session_id AS sessionId, run_id AS runId, sender, status
         FROM channel_bindings`,
      )
      .all() as ChannelBinding[];
  }
}
import { compactRunEvent, boundRunEvents, type RunEventCursor, type RunEventPage } from "@capsule/shared";
