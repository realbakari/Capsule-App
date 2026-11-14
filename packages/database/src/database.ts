import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { nowIso } from "@capsule/shared";
import { MIGRATIONS } from "./schema.js";

export class CapsuleDatabase {
  readonly sqlite: Database.Database;

  constructor(filePath: string) {
    const dir = path.dirname(filePath);
    if (dir && dir !== "." && filePath !== ":memory:") {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.sqlite = new Database(filePath);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.migrate();
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = new Set(
      this.sqlite
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map((row) => (row as { version: number }).version),
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version) && (!migration.present || migration.present(this.sqlite))) continue;
      const tx = this.sqlite.transaction(() => {
        if (migration.sql) this.sqlite.exec(migration.sql);
        migration.run?.(this.sqlite);
        this.sqlite
          .prepare("INSERT OR REPLACE INTO schema_migrations (version, applied_at) VALUES (?, ?)")
          .run(migration.version, nowIso());
      });
      tx();
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
