import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppPaths } from "./config.js";

export class DatabaseManager {
  private database!: Database.Database;

  constructor(
    public readonly paths: AppPaths,
    private readonly migrationsDir = path.resolve("database/migrations"),
  ) {
    this.open();
  }

  get db(): Database.Database {
    return this.database;
  }

  open(): void {
    this.database = new Database(this.paths.dataFile);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("synchronous = FULL");
    this.migrate();
  }

  close(): void {
    if (this.database?.open) {
      this.database.pragma("wal_checkpoint(TRUNCATE)");
      this.database.close();
    }
  }

  reopen(): void {
    this.close();
    this.open();
  }

  migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const applied = this.database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
    const insert = this.database.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)");
    for (const file of files) {
      if (applied.get(file)) continue;
      const sql = fs.readFileSync(path.join(this.migrationsDir, file), "utf8");
      this.database.transaction(() => {
        this.database.exec(sql);
        insert.run(file, new Date().toISOString());
      })();
    }
    this.database.pragma("optimize");
  }

  checkpoint(): void {
    this.database.pragma("wal_checkpoint(TRUNCATE)");
  }

  integrityCheck(): string {
    const row = this.database.pragma("integrity_check", { simple: true });
    return String(row);
  }
}
