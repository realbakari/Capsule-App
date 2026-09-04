import type {
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
  Project,
  Run,
  RunEvent,
  Session,
  Skill,
  SkillPack,
  Workspace,
} from "@capsule/shared";
import { isHarnessId } from "@capsule/shared";
import type { CapsuleDatabase } from "./database.js";

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
    pinned: session.pinned ? 1 : 0,
    pinOrder: session.pinOrder ?? null,
    workingDirectory: session.workingDirectory ?? null,
    workspaceMode: session.workspaceMode ?? "local",
    worktreeBranch: session.worktreeBranch ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function normalizeSession(row: Session): Session {
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
    pinned: Boolean(row.pinned),
    pinOrder: typeof row.pinOrder === "number" ? row.pinOrder : undefined,
    openclawSessionKey: row.openclawSessionKey || undefined,
    workingDirectory: row.workingDirectory || undefined,
    workspaceMode: row.workspaceMode === "worktree" ? "worktree" : "local",
    worktreeBranch: row.worktreeBranch || undefined,
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
          default_skill_ids, default_mode, default_workspace_mode, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @name, @description, @workingDirectory, @extraFolders, @actions, @iconPath, @defaultAgentId,
          @defaultSkillIds, @defaultMode, @defaultWorkspaceMode, @createdAt, @updatedAt
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
                created_at AS createdAt, updated_at AS updatedAt
         FROM projects ORDER BY updated_at DESC`,
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
          worktree_branch, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @projectId, @agentId, @title, @mode, @state,
          @openclawSessionKey, @harnessId, @harnessState, @acpMode,
          @permissionProfile, @modelOverride, @pinned, @pinOrder, @workingDirectory, @workspaceMode,
          @worktreeBranch, @createdAt, @updatedAt
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
         worktree_branch = @worktreeBranch, updated_at = @updatedAt WHERE id = @id`,
      )
      .run(sessionParams(session));
  }

  deleteSession(id: string): void {
    const runIds = (
      this.db.sqlite.prepare("SELECT id FROM runs WHERE session_id = ?").all(id) as Array<{ id: string; }>
    ).map((row) => row.id);
    this.deleteRuns(runIds);
    this.db.sqlite.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM artifacts WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(id);
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
                worktree_branch AS worktreeBranch, created_at AS createdAt, updated_at AS updatedAt`;
    const sql = projectId
      ? `SELECT ${columns} FROM sessions WHERE project_id = ?
         ORDER BY pinned DESC, COALESCE(pin_order, 2147483647) ASC, updated_at DESC`
      : `SELECT ${columns} FROM sessions
         ORDER BY pinned DESC, COALESCE(pin_order, 2147483647) ASC, updated_at DESC`;
    const rows = (
      projectId ? this.db.sqlite.prepare(sql).all(projectId) : this.db.sqlite.prepare(sql).all()
    ) as Session[];
    return rows.map(normalizeSession);
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

  listMessages(sessionId: string): ChatMessage[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, role, content, attachments, kind,
                run_id AS runId, created_at AS createdAt
         FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
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
    const columns = `id, session_id AS sessionId, role, content, attachments, kind,
                     run_id AS runId, created_at AS createdAt`;
    const rows = before
      ? (this.db.sqlite
          .prepare(
            `SELECT ${columns} FROM messages
             WHERE session_id = @sessionId
               AND (created_at < @createdAt OR (created_at = @createdAt AND id < @id))
             ORDER BY created_at DESC, id DESC LIMIT @limit`,
          )
          .all({ sessionId, createdAt: before.createdAt, id: before.id, limit }) as Array<
          Omit<ChatMessage, "attachments"> & { attachments: string; }
        >)
      : (this.db.sqlite
          .prepare(
            `SELECT ${columns} FROM messages WHERE session_id = @sessionId
             ORDER BY created_at DESC, id DESC LIMIT @limit`,
          )
          .all({ sessionId, limit }) as Array<
          Omit<ChatMessage, "attachments"> & { attachments: string; }
        >);
    // Query is newest-first so LIMIT takes the right end; callers want reading order.
    return rows.reverse().map((row) => {
      const attachments = parseJson<NonNullable<ChatMessage["attachments"]>>(row.attachments, []);
      return { ...row, attachments: attachments.length > 0 ? attachments : undefined };
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
          error, openclaw_run_id, checkpoint_ref, working_directory, revision, verification, created_at, updated_at, completed_at
        ) VALUES (
          @id, @sessionId, @projectId, @agentId, @skillId, @contractId, @status, @prompt, @result,
          @error, @openclawRunId, @checkpointRef, @workingDirectory, @revision, @verification, @createdAt, @updatedAt, @completedAt
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
              openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef,
              working_directory AS workingDirectory, revision, verification,
              created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt
       FROM runs WHERE id = ?`,
    ).get(id) as (Omit<Run, "revision" | "verification"> & { revision: string | null; verification: string | null }) | undefined;
    return row ? { ...row, revision: row.revision ? JSON.parse(row.revision) : undefined, verification: row.verification ? JSON.parse(row.verification) : undefined } : undefined;
  }

  listRuns(sessionId?: string): Run[] {
    const sql = sessionId
      ? `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef,
                working_directory AS workingDirectory, revision, verification,
                created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs WHERE session_id = ? ORDER BY created_at DESC`
      : `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, checkpoint_ref AS checkpointRef,
                working_directory AS workingDirectory, revision, verification,
                created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs ORDER BY created_at DESC`;
    const rows = (sessionId
      ? this.db.sqlite.prepare(sql).all(sessionId)
      : this.db.sqlite.prepare(sql).all()) as Array<Omit<Run, "revision" | "verification"> & { revision: string | null; verification: string | null; }>;
    return rows.map((row) => ({ ...row, revision: row.revision ? JSON.parse(row.revision) : undefined, verification: row.verification ? JSON.parse(row.verification) : undefined }));
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
         FROM run_events WHERE run_id = ? ORDER BY timestamp ASC`,
      )
      .all(runId) as Array<Omit<RunEvent, "data"> & { data: string | null; }>;
    return rows.map((row) => ({
      ...row,
      data: parseJson(row.data, undefined),
    }));
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
          id, run_id, agent_id, agent_name, action, target, reason, status, created_at, resolved_at
        ) VALUES (
          @id, @runId, @agentId, @agentName, @action, @target, @reason, @status, @createdAt, @resolvedAt
        )`,
      )
      .run({ ...approval, resolvedAt: approval.resolvedAt ?? null });
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
                reason, status, created_at AS createdAt, resolved_at AS resolvedAt
         FROM approvals WHERE status = ? ORDER BY created_at DESC`
      : `SELECT id, run_id AS runId, agent_id AS agentId, agent_name AS agentName, action, target,
                reason, status, created_at AS createdAt, resolved_at AS resolvedAt
         FROM approvals ORDER BY created_at DESC`;
    return (status
      ? this.db.sqlite.prepare(sql).all(status)
      : this.db.sqlite.prepare(sql).all()) as ApprovalRequest[];
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
