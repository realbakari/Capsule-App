import type Database from "better-sqlite3";

export interface Migration {
  version: number;
  sql: string;
  /**
   * For a version number that another build also used for something else:
   * whether this migration's own change is in the database. A recorded
   * version whose change is missing runs again.
   */
  present?: (db: Database.Database) => boolean;
  /** Work that depends on what the database already has, run after `sql`. */
  run?: (db: Database.Database) => void;
}

export function hasColumn(db: Database.Database, table: string, column: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((row) => row.name === column);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export const MIGRATIONS: Migration[] = [
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
  {
    version: 8,
    sql: `
      ALTER TABLE projects ADD COLUMN project_actions TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE sessions ADD COLUMN workspace_mode TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE sessions ADD COLUMN worktree_branch TEXT;
    `,
  },
  {
    version: 9,
    sql: `
      ALTER TABLE projects ADD COLUMN icon_path TEXT;
      ALTER TABLE sessions ADD COLUMN pin_order INTEGER;
      ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 10,
    sql: `
      -- Null means the project follows the app-wide default.
      ALTER TABLE projects ADD COLUMN default_workspace_mode TEXT;
    `,
  },
  {
    version: 11,
    sql: `
      -- The git ref holding what the worktree looked like when this turn
      -- finished. It was captured on every turn and then dropped on the floor:
      -- nothing wrote it down, so "what changed in this turn" and "restore
      -- this turn" had nothing to read.
      ALTER TABLE runs ADD COLUMN checkpoint_ref TEXT;
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE runs ADD COLUMN working_directory TEXT;
      ALTER TABLE runs ADD COLUMN revision TEXT;
      ALTER TABLE runs ADD COLUMN verification TEXT;
    `,
  },
  {
    version: 13,
    sql: `CREATE INDEX IF NOT EXISTS idx_run_events_cursor ON run_events(run_id, timestamp);`,
  },
  {
    version: 14,
    sql: `CREATE INDEX IF NOT EXISTS idx_runs_session_created ON runs(session_id, created_at);`,
  },
  {
    version: 15,
    sql: `
      CREATE INDEX IF NOT EXISTS idx_runs_history ON runs(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_session_history ON runs(session_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_project_history ON runs(project_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_reply ON messages(session_id, run_id, role);
    `,
  },
  {
    version: 16,
    sql: `ALTER TABLE approvals ADD COLUMN details TEXT;`,
  },
  {
    version: 17,
    sql: `ALTER TABLE sessions ADD COLUMN direct_session TEXT;`,
  },
  {
    version: 18,
    sql: `CREATE INDEX IF NOT EXISTS idx_runs_checkpoint_base
      ON runs(session_id, working_directory, created_at)
      WHERE checkpoint_ref IS NOT NULL;`,
  },
  {
    version: 19,
    sql: `ALTER TABLE sessions ADD COLUMN carry_over TEXT;`,
  },
  {
    // Builds of the customization work recorded 20 and 21 for other columns.
    version: 20,
    present: (db) => hasColumn(db, "sessions", "pending_start"),
    sql: `
      ALTER TABLE sessions ADD COLUMN pending_start TEXT;
      ALTER TABLE sessions ADD COLUMN done_at TEXT;
    `,
  },
  {
    version: 21,
    present: (db) => hasColumn(db, "sessions", "forked_from"),
    sql: `
      ALTER TABLE sessions ADD COLUMN forked_from TEXT;
      -- What one restore took away, so Redo can put it back. The rows a
      -- conversation restore removed are parked here verbatim rather than
      -- flagged in place: a flag would have to be honoured by every query that
      -- reads a transcript or a run, and missing one would show a removed
      -- turn. A new turn in the thread discards its points.
      CREATE TABLE IF NOT EXISTS restore_points (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        target_run_id TEXT,
        scope TEXT NOT NULL,
        edit INTEGER NOT NULL DEFAULT 0,
        files_ref TEXT,
        files_cwd TEXT,
        parked_rows TEXT NOT NULL DEFAULT '{}',
        hidden_messages INTEGER NOT NULL DEFAULT 0,
        agent_before TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_restore_points_session ON restore_points(session_id, created_at);
    `,
  },
  {
    version: 22,
    sql: `
      ALTER TABLE sessions ADD COLUMN turn_mode TEXT;
      ALTER TABLE runs ADD COLUMN turn_mode TEXT;
    `,
  },
  {
    version: 23,
    sql: `
      -- Read-only links to one thread. The secret is never stored, only its
      -- hash, and a revoked link keeps its row so the revocation is a fact.
      CREATE TABLE IF NOT EXISTS share_grants (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        label TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_share_grants_session ON share_grants(session_id, created_at);
    `,
  },
  {
    version: 24,
    sql: `
      -- Best-of-N: a comparison is a group of ordinary threads. The thread
      -- carries its group, written once when it is created.
      ALTER TABLE sessions ADD COLUMN group_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_sessions_group ON sessions(group_id) WHERE group_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS thread_groups (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        prompt TEXT NOT NULL,
        candidates TEXT NOT NULL DEFAULT '[]',
        winner_session_id TEXT,
        decided_at TEXT,
        created_at TEXT NOT NULL
      );
      -- Thumbs on final replies. The agent and model are copied in when the
      -- rating is made, so the leaderboard survives the thread being deleted.
      CREATE TABLE IF NOT EXISTS run_ratings (
        run_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        harness_id TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        value INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_ratings_session ON run_ratings(session_id);
    `,
  },
  {
    version: 25,
    sql: `
      -- Where a thread came from: an agent's own history, or another thread
      -- it continues. Written once when the thread is created.
      ALTER TABLE sessions ADD COLUMN origin TEXT;
    `,
  },
  {
    version: 26,
    sql: `
      -- A worktree thread's pull request as last read, so the sidebar can
      -- show its state without asking GitHub for every thread.
      ALTER TABLE sessions ADD COLUMN pull_request TEXT;
    `,
  },
  {
    version: 27,
    sql: `
      -- A paused worktree thread: where its work was saved and what was stopped.
      ALTER TABLE sessions ADD COLUMN paused TEXT;
    `,
  },
  {
    version: 28,
    sql: `
      -- The user's labels on a thread, as a JSON array of canonical tags.
      ALTER TABLE sessions ADD COLUMN tags TEXT;
    `,
  },
  {
    // Triage state, apart from run status. Existing threads count as read up
    // to now, or every finished thread would light up unread on upgrade.
    version: 120,
    sql: `
      ALTER TABLE sessions ADD COLUMN last_viewed_at TEXT;
      ALTER TABLE sessions ADD COLUMN settled_at TEXT;
      ALTER TABLE sessions ADD COLUMN snoozed_until TEXT;
      UPDATE sessions SET last_viewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
    `,
  },
  {
    version: 130,
    sql: `
      -- What a worktree conversation's branch started from, and a project's
      -- choice for new ones. Null means the remote default branch, else HEAD.
      ALTER TABLE sessions ADD COLUMN worktree_base_ref TEXT;
      ALTER TABLE projects ADD COLUMN default_worktree_base_ref TEXT;
    `,
  },
  {
    // A project order the person set by dragging; null keeps the recency order.
    version: 121,
    sql: `ALTER TABLE projects ADD COLUMN sort_order INTEGER;`,
  },
  {
    // The agent profile and automation that started a thread. Builds of the
    // customization work added these as 20 and 21, so each column is added
    // only when missing. Those builds also kept an `unread` flag for
    // automation threads; unread is `last_viewed_at` now, so a thread still
    // flagged goes back to never viewed.
    version: 140,
    sql: "",
    run: (db) => {
      addColumnIfMissing(db, "sessions", "profile_id", "TEXT");
      addColumnIfMissing(db, "sessions", "automation_id", "TEXT");
      if (hasColumn(db, "sessions", "unread")) db.exec("UPDATE sessions SET last_viewed_at = NULL WHERE unread = 1");
    },
  },
];
