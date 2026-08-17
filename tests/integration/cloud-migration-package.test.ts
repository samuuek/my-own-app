import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../server/database.js";
import { getAppPaths } from "../../server/config.js";
import type { QueryResult, Queryable } from "../../server/cloud/database.js";
import {
  exportMigrationPackage,
  readMigrationPackage,
  type MigrationPackage,
} from "../../scripts/export-cloud-data.js";
import {
  importCloudData,
  type MigrationCloudDatabase,
  type MigrationUploader,
} from "../../scripts/import-cloud-data.js";
import { verifyCloudData } from "../../scripts/verify-cloud-data.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) removeTestDirectory(directory);
});

describe("SQLite to cloud migration package", () => {
  it("exports every collection with deleted rows, settings, reviews, counts and a canonical hash", () => {
    const fixture = createFixture();
    const outputPath = path.join(fixture.directory, "migration-output", "package.json");

    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath,
      now: () => new Date("2026-08-16T10:00:00.000Z"),
    });

    expect(pkg.manifest.formatVersion).toBe(1);
    expect(pkg.manifest.sourceIntegrity).toBe("ok");
    expect(pkg.collections.planItems).toHaveLength(2);
    expect(pkg.collections.planItems.map((item) => item.id)).toEqual(["plan-active", "plan-deleted"]);
    expect(pkg.collections.planItems[1].deleted_at).toBe("2026-08-16T09:30:00.000Z");
    expect(pkg.settings.appearance).toBe("ios");
    expect(pkg.settingUpdatedAt.appearance).toBe("2026-08-16T09:00:00.000Z");
    expect(pkg.dailyReviews).toEqual([{
      review_date: "2026-08-16",
      content: "稳步前进",
      created_at: "2026-08-16T08:00:00.000Z",
      updated_at: "2026-08-16T08:30:00.000Z",
    }]);
    expect(pkg.counts.planItems).toEqual({ active: 1, deleted: 1, total: 2 });
    expect(pkg.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(readMigrationPackage(outputPath)).toEqual(pkg);
  });

  it("rejects tampered packages and keeps dry-run free of cloud writes", async () => {
    const { pkg } = exportFixture();
    const database = new MemoryCloudDatabase();
    const tampered = structuredClone(pkg);
    tampered.collections.planItems[0].title = "被篡改";

    await expect(importCloudData({ pkg: tampered, database })).rejects.toThrow("校验");
    await expect(importCloudData({ pkg: { ...pkg, manifest: { ...pkg.manifest, formatVersion: 2 as 1 } }, database })).rejects.toThrow("版本");

    const result = await importCloudData({ pkg, database, dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.counts.planItems).toEqual({ active: 1, deleted: 1, total: 2 });
    expect(database.transactionCalls).toBe(0);
    expect(database.queryCalls).toHaveLength(0);
  });

  it("imports entities, settings, and reviews idempotently in transactions and verifies canonical cloud data", async () => {
    const { pkg } = exportFixture();
    const database = new MemoryCloudDatabase();

    await importCloudData({ pkg, database });
    await importCloudData({ pkg, database });

    expect(database.transactionCalls).toBe(2);
    expect(database.entities.size).toBe(totalEntities(pkg));
    expect(database.settings.get("appearance")).toEqual({
      value: "ios",
      updated_at: "2026-08-16T09:00:00.000Z",
    });
    expect(database.dailyReviews.get("2026-08-16")?.payload.content).toBe("稳步前进");
    expect(database.queryCalls.some(({ text }) => text.includes("ON CONFLICT(collection, id) DO UPDATE"))).toBe(true);

    const log = vi.fn();
    const result = await verifyCloudData({ pkg, queryable: database, log });
    expect(result.sha256).toBe(pkg.manifest.sha256);
    expect(log).toHaveBeenCalledWith("planItems active=1 deleted=1 total=2");
    expect(log.mock.calls.every(([line]) => /^[A-Za-z]+ active=\d+ deleted=\d+ total=\d+$/.test(String(line)))).toBe(true);
  });

  it("exits verification with a mismatch after printing counts only", async () => {
    const { pkg } = exportFixture();
    const database = new MemoryCloudDatabase();
    await importCloudData({ pkg, database });
    database.entities.delete("planItems:plan-active");
    const log = vi.fn();

    await expect(verifyCloudData({ pkg, queryable: database, log })).rejects.toThrow("不一致");
    expect(log).toHaveBeenCalledWith("planItems active=0 deleted=1 total=1");
    expect(log.mock.calls.every(([line]) => !String(line).includes("sha256") && !String(line).includes("DATABASE_URL"))).toBe(true);
  });

  it("uploads explicitly sourced reading attachments to deterministic private Blob paths", async () => {
    const fixture = createFixture({ attachment: true });
    const outputPath = path.join(fixture.directory, "package.json");
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath,
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    const database = new MemoryCloudDatabase();
    const upload = vi.fn(async () => undefined);
    const uploader: MigrationUploader = { upload };

    expect(pkg.attachments).toEqual([expect.objectContaining({
      bookId: "book-with-pdf",
      kind: "pdf",
      fileId: "fixture.pdf",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
    await expect(importCloudData({ pkg, database, uploader })).rejects.toThrow("附件目录");

    await importCloudData({ pkg, database, uploader, attachmentsDirectory: fixture.attachmentsDirectory });
    expect(upload).toHaveBeenCalledWith(
      "reading/books/book-with-pdf/fixture.pdf",
      expect.any(Buffer),
      { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/pdf" },
    );
  });

  it("validates every local attachment before starting any private Blob upload", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    pkg.attachments.push({
      ...pkg.attachments[0],
      kind: "cover",
      fileId: "missing.png",
      filename: "missing.png",
      contentType: "image/png",
    });
    const upload = vi.fn(async () => undefined);

    await expect(importCloudData({
      pkg,
      database: new MemoryCloudDatabase(),
      uploader: { upload },
      attachmentsDirectory: fixture.attachmentsDirectory,
    })).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects attachment identifiers that could escape the private book path", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    pkg.attachments[0].bookId = "../escape";
    const upload = vi.fn(async () => undefined);

    await expect(importCloudData({
      pkg,
      database: new MemoryCloudDatabase(),
      uploader: { upload },
      attachmentsDirectory: fixture.attachmentsDirectory,
    })).rejects.toThrow("附件");
    expect(upload).not.toHaveBeenCalled();
  });

  it("rejects an attachment manifest that omits a file referenced by a book", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    pkg.attachments = [];
    const database = new MemoryCloudDatabase();

    await expect(importCloudData({ pkg, database, attachmentsDirectory: fixture.attachmentsDirectory })).rejects.toThrow("附件");
    expect(database.transactionCalls).toBe(0);
  });
});

function createFixture(options: { attachment?: boolean } = {}) {
  const directory = makeTestDirectory("cloud-migration");
  directories.push(directory);
  const paths = getAppPaths(directory);
  const manager = new DatabaseManager(paths);
  try {
    const db = manager.db;
    db.prepare(`INSERT INTO plan_items(
      id, title, plan_date, priority, status, complete_source, notes, sort_order, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "plan-active", "今天完成", "2026-08-16", "medium", "todo", 0, "", 0,
      "2026-08-16T07:00:00.000Z", "2026-08-16T07:30:00.000Z", null,
    );
    db.prepare(`INSERT INTO plan_items(
      id, title, plan_date, priority, status, complete_source, notes, sort_order, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "plan-deleted", "已移入回收站", "2026-08-16", "low", "todo", 0, "", 1,
      "2026-08-16T07:05:00.000Z", "2026-08-16T09:30:00.000Z", "2026-08-16T09:30:00.000Z",
    );
    db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ?").run('"ios"', "2026-08-16T09:00:00.000Z", "appearance");
    db.prepare("INSERT INTO daily_reviews(review_date, content, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      "2026-08-16", "稳步前进", "2026-08-16T08:00:00.000Z", "2026-08-16T08:30:00.000Z",
    );
    if (options.attachment) {
      db.prepare(`INSERT INTO books(
        id, title, author, status, current_page, description, pdf_file_id, pdf_filename, created_at, updated_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        "book-with-pdf", "带附件的书", "", "reading", 0, "", "fixture.pdf", "fixture.pdf",
        "2026-08-16T06:00:00.000Z", "2026-08-16T06:00:00.000Z", null,
      );
      fs.writeFileSync(path.join(paths.readingFilesDir, "fixture.pdf"), "%PDF-1.7\nfixture\n%%EOF");
    }
    manager.checkpoint();
  } finally {
    manager.close();
  }
  return {
    directory,
    databasePath: paths.dataFile,
    attachmentsDirectory: paths.readingFilesDir,
  };
}

function exportFixture(): { pkg: MigrationPackage; directory: string } {
  const fixture = createFixture();
  const outputPath = path.join(fixture.directory, "package.json");
  return {
    directory: fixture.directory,
    pkg: exportMigrationPackage({ databasePath: fixture.databasePath, outputPath }),
  };
}

function totalEntities(pkg: MigrationPackage): number {
  return Object.values(pkg.collections).reduce((total, rows) => total + rows.length, 0);
}

type StoredEntity = {
  collection: string;
  id: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

class MemoryCloudDatabase implements MigrationCloudDatabase, Queryable {
  entities = new Map<string, StoredEntity>();
  settings = new Map<string, { value: unknown; updated_at: string }>();
  dailyReviews = new Map<string, { payload: Record<string, unknown>; created_at: string; updated_at: string }>();
  transactionCalls = 0;
  queryCalls: Array<{ text: string; values: unknown[] }> = [];

  async transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    return work(this);
  }

  async query<T>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.queryCalls.push({ text, values });
    if (text.includes("INSERT INTO workspace_entities")) {
      const [collection, id, rawPayload, createdAt, updatedAt, deletedAt] = values as [string, string, string, string, string, string | null];
      this.entities.set(`${collection}:${id}`, {
        collection, id, payload: JSON.parse(rawPayload), created_at: createdAt, updated_at: updatedAt, deleted_at: deletedAt,
      });
      return { rows: [] };
    }
    if (text.includes("INSERT INTO workspace_settings")) {
      const [key, rawValue, updatedAt] = values as [string, string, string];
      this.settings.set(key, { value: JSON.parse(rawValue), updated_at: updatedAt });
      return { rows: [] };
    }
    if (text.includes("INSERT INTO workspace_daily_reviews")) {
      const [date, rawPayload, createdAt, updatedAt] = values as [string, string, string, string];
      this.dailyReviews.set(date, { payload: JSON.parse(rawPayload), created_at: createdAt, updated_at: updatedAt });
      return { rows: [] };
    }
    if (text.includes("GROUP BY collection") && text.includes("jsonb_agg")) {
      const grouped = new Map<string, StoredEntity[]>();
      for (const row of this.entities.values()) grouped.set(row.collection, [...(grouped.get(row.collection) ?? []), row]);
      return {
        rows: [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([collection, rows]) => ({
          collection,
          items: rows.sort((left, right) => left.id.localeCompare(right.id)).map((row) => structuredClone(row.payload)),
        })) as T[],
      };
    }
    if (text.includes("jsonb_object_agg") && text.includes("workspace_settings")) {
      return {
        rows: [{
          settings: Object.fromEntries([...this.settings].sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, item.value])),
          setting_updated_at: Object.fromEntries([...this.settings].sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, item.updated_at])),
        }] as T[],
      };
    }
    if (text.includes("workspace_daily_reviews") && text.includes("jsonb_agg")) {
      return {
        rows: [{
          reviews: [...this.dailyReviews].sort(([left], [right]) => left.localeCompare(right)).map(([, item]) => structuredClone(item.payload)),
        }] as T[],
      };
    }
    throw new Error(`Unexpected SQL in migration test: ${text}`);
  }
}
