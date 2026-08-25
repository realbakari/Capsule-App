import type {
  Agent,
  ApprovalRequest,
  Artifact,
  ChannelBinding,
  ChatMessage,
  ExecutionContract,
  PolicyDecision,
  PolicyRule,
  Project,
  Run,
  RunEvent,
  Session,
  Skill,
  Workspace,
} from "@capsule/shared";
import type { CapsuleDatabase } from "./database.js";

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class CapsuleRepositories {
  constructor(private readonly db: CapsuleDatabase) {}

  getSetting(key: string): string | undefined {
    const row = this.db.sqlite
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
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
          id, workspace_id, name, description, working_directory, default_agent_id,
          default_skill_ids, default_mode, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @name, @description, @workingDirectory, @defaultAgentId,
          @defaultSkillIds, @defaultMode, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...project,
        description: project.description ?? null,
        workingDirectory: project.workingDirectory ?? null,
        defaultAgentId: project.defaultAgentId ?? null,
        defaultSkillIds: JSON.stringify(project.defaultSkillIds),
      });
  }

  listProjects(): Project[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, workspace_id AS workspaceId, name, description, working_directory AS workingDirectory,
                default_agent_id AS defaultAgentId, default_skill_ids AS defaultSkillIds,
                default_mode AS defaultMode, created_at AS createdAt, updated_at AS updatedAt
         FROM projects ORDER BY updated_at DESC`,
      )
      .all() as Array<Omit<Project, "defaultSkillIds"> & { defaultSkillIds: string }>;
    return rows.map((row) => ({
      ...row,
      defaultSkillIds: parseJson<string[]>(row.defaultSkillIds, []),
    }));
  }

  getProject(id: string): Project | undefined {
    return this.listProjects().find((project) => project.id === id);
  }

  updateProject(project: Project): void {
    this.db.sqlite
      .prepare(
        `UPDATE projects SET name = @name, description = @description, working_directory = @workingDirectory,
         default_agent_id = @defaultAgentId, default_skill_ids = @defaultSkillIds, default_mode = @defaultMode,
         updated_at = @updatedAt WHERE id = @id`,
      )
      .run({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        workingDirectory: project.workingDirectory ?? null,
        defaultAgentId: project.defaultAgentId ?? null,
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
          openclaw_session_key, created_at, updated_at
        ) VALUES (
          @id, @workspaceId, @projectId, @agentId, @title, @mode, @state,
          @openclawSessionKey, @createdAt, @updatedAt
        )`,
      )
      .run({
        ...session,
        openclawSessionKey: session.openclawSessionKey ?? null,
      });
  }

  updateSession(session: Session): void {
    this.db.sqlite
      .prepare(
        `UPDATE sessions SET title = @title, agent_id = @agentId, mode = @mode, state = @state,
         openclaw_session_key = @openclawSessionKey, updated_at = @updatedAt WHERE id = @id`,
      )
      .run({
        id: session.id,
        title: session.title,
        agentId: session.agentId,
        mode: session.mode,
        state: session.state,
        openclawSessionKey: session.openclawSessionKey ?? null,
        updatedAt: session.updatedAt,
      });
  }

  deleteSession(id: string): void {
    this.db.sqlite.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    this.db.sqlite.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  listSessions(projectId?: string): Session[] {
    const sql = projectId
      ? `SELECT id, workspace_id AS workspaceId, project_id AS projectId, agent_id AS agentId,
                title, mode, state, openclaw_session_key AS openclawSessionKey,
                created_at AS createdAt, updated_at AS updatedAt
         FROM sessions WHERE project_id = ? ORDER BY updated_at DESC`
      : `SELECT id, workspace_id AS workspaceId, project_id AS projectId, agent_id AS agentId,
                title, mode, state, openclaw_session_key AS openclawSessionKey,
                created_at AS createdAt, updated_at AS updatedAt
         FROM sessions ORDER BY updated_at DESC`;
    return (projectId
      ? this.db.sqlite.prepare(sql).all(projectId)
      : this.db.sqlite.prepare(sql).all()) as Session[];
  }

  getSession(id: string): Session | undefined {
    return this.listSessions().find((session) => session.id === id);
  }

  insertMessage(message: ChatMessage): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO messages (id, session_id, role, content, run_id, created_at)
         VALUES (@id, @sessionId, @role, @content, @runId, @createdAt)`,
      )
      .run({ ...message, runId: message.runId ?? null });
  }

  listMessages(sessionId: string): ChatMessage[] {
    return this.db.sqlite
      .prepare(
        `SELECT id, session_id AS sessionId, role, content, run_id AS runId, created_at AS createdAt
         FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      )
      .all(sessionId) as ChatMessage[];
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
          id, name, version, description, source, status, requirements, permissions, validation
        ) VALUES (
          @id, @name, @version, @description, @source, @status, @requirements, @permissions, @validation
        ) ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          version = excluded.version,
          description = excluded.description,
          source = excluded.source,
          status = excluded.status,
          requirements = excluded.requirements,
          permissions = excluded.permissions,
          validation = excluded.validation`,
      )
      .run({
        ...skill,
        requirements: JSON.stringify(skill.requirements),
        permissions: JSON.stringify(skill.permissions),
        validation: skill.validation ?? null,
      });
  }

  listSkills(): Skill[] {
    const rows = this.db.sqlite
      .prepare(
        `SELECT id, name, version, description, source, status, requirements, permissions, validation
         FROM skills ORDER BY name`,
      )
      .all() as Array<
      Omit<Skill, "requirements" | "permissions"> & {
        requirements: string;
        permissions: string;
      }
    >;
    return rows.map((row) => ({
      ...row,
      requirements: parseJson<string[]>(row.requirements, []),
      permissions: parseJson(row.permissions, {}),
    }));
  }

  insertRun(run: Run): void {
    this.db.sqlite
      .prepare(
        `INSERT INTO runs (
          id, session_id, project_id, agent_id, skill_id, contract_id, status, prompt, result,
          error, openclaw_run_id, created_at, updated_at, completed_at
        ) VALUES (
          @id, @sessionId, @projectId, @agentId, @skillId, @contractId, @status, @prompt, @result,
          @error, @openclawRunId, @createdAt, @updatedAt, @completedAt
        )`,
      )
      .run({
        ...run,
        skillId: run.skillId ?? null,
        contractId: run.contractId ?? null,
        result: run.result ?? null,
        error: run.error ?? null,
        openclawRunId: run.openclawRunId ?? null,
        completedAt: run.completedAt ?? null,
      });
  }

  updateRun(run: Run): void {
    this.db.sqlite
      .prepare(
        `UPDATE runs SET status = @status, result = @result, error = @error,
         openclaw_run_id = @openclawRunId, updated_at = @updatedAt, completed_at = @completedAt,
         contract_id = @contractId WHERE id = @id`,
      )
      .run({
        id: run.id,
        status: run.status,
        result: run.result ?? null,
        error: run.error ?? null,
        openclawRunId: run.openclawRunId ?? null,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt ?? null,
        contractId: run.contractId ?? null,
      });
  }

  getRun(id: string): Run | undefined {
    return this.listRuns().find((run) => run.id === id);
  }

  listRuns(sessionId?: string): Run[] {
    const sql = sessionId
      ? `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs WHERE session_id = ? ORDER BY created_at DESC`
      : `SELECT id, session_id AS sessionId, project_id AS projectId, agent_id AS agentId,
                skill_id AS skillId, contract_id AS contractId, status, prompt, result, error,
                openclaw_run_id AS openclawRunId, created_at AS createdAt, updated_at AS updatedAt,
                completed_at AS completedAt FROM runs ORDER BY created_at DESC`;
    return (sessionId
      ? this.db.sqlite.prepare(sql).all(sessionId)
      : this.db.sqlite.prepare(sql).all()) as Run[];
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
      .all(runId) as Array<Omit<RunEvent, "data"> & { data: string | null }>;
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
    this.db.sqlite
      .prepare(
        `INSERT INTO policies (id, scope, scope_id, resource, action, decision)
         VALUES (@id, @scope, @scopeId, @resource, @action, @decision)`,
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
