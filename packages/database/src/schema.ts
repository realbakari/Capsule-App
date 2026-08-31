export const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        working_directory TEXT,
        default_agent_id TEXT,
        default_skill_ids TEXT NOT NULL DEFAULT '[]',
        default_mode TEXT NOT NULL DEFAULT 'chat',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'chat',
        state TEXT NOT NULL DEFAULT 'active',
        openclaw_session_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        run_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        runtime TEXT NOT NULL,
        model TEXT,
        workspace TEXT,
        skills TEXT NOT NULL DEFAULT '[]',
        tools TEXT NOT NULL DEFAULT '[]',
        permissions TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'idle',
        kind TEXT NOT NULL DEFAULT 'agent',
        recent_run_ids TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        requirements TEXT NOT NULL DEFAULT '[]',
        permissions TEXT NOT NULL DEFAULT '{}',
        validation TEXT
      );

      CREATE TABLE IF NOT EXISTS skill_versions (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (skill_id) REFERENCES skills(id)
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        skill_id TEXT,
        contract_id TEXT,
        status TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result TEXT,
        error TEXT,
        openclaw_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS run_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        message TEXT NOT NULL,
        data TEXT,
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );

      CREATE TABLE IF NOT EXISTS contracts (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        required TEXT NOT NULL DEFAULT '[]',
        forbidden TEXT NOT NULL DEFAULT '[]',
        human_summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS policies (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        decision TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS policy_decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        rule_id TEXT,
        resource TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT,
        mime_type TEXT,
        content TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_bindings (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        room TEXT,
        thread TEXT,
        session_id TEXT,
        run_id TEXT,
        sender TEXT,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events(run_id);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE sessions ADD COLUMN harness_id TEXT;
      ALTER TABLE sessions ADD COLUMN harness_state TEXT;
      ALTER TABLE sessions ADD COLUMN acp_mode TEXT;
      ALTER TABLE sessions ADD COLUMN permission_profile TEXT;
      ALTER TABLE sessions ADD COLUMN model_override TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE messages ADD COLUMN kind TEXT;

      -- Steers used to be recorded by prefixing the content with 'Steer: '.
      -- Lift that marker into the column once, here, so the renderer never has
      -- to infer intent from message text.
      UPDATE messages SET kind = 'steer', content = substr(content, 8)
       WHERE role = 'user' AND content LIKE 'Steer: %';
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE sessions ADD COLUMN working_directory TEXT;
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE projects ADD COLUMN extra_folders TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE skills ADD COLUMN pack_id TEXT;
      ALTER TABLE skills ADD COLUMN pack_name TEXT;
      ALTER TABLE skills ADD COLUMN content TEXT;
      ALTER TABLE skills ADD COLUMN installs INTEGER;
      ALTER TABLE skills ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE skills ADD COLUMN author TEXT;
      ALTER TABLE skills ADD COLUMN url TEXT;

      CREATE TABLE IF NOT EXISTS skill_packs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        author TEXT,
        url TEXT,
        install_command TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        skill_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `,
  },
];
