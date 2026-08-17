import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseManager } from "../../server/database.js";
import { getAppPaths } from "../../server/config.js";
import type { QueryResult, Queryable } from "../../server/cloud/database.js";
import { CloudReadingFileManager } from "../../server/cloud/reading-files.js";
import {
  calculatePackageHash,
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

  it.each(["same-path", "hardlink", "symlink"] as const)("rejects a %s output alias without changing the source backup", (aliasKind) => {
    const fixture = createFixture();
    const before = fileHash(fixture.databasePath);
    const outputPath = aliasKind === "same-path" ? fixture.databasePath : path.join(fixture.directory, `${aliasKind}.json`);
    if (aliasKind === "hardlink") fs.linkSync(fixture.databasePath, outputPath);
    if (aliasKind === "symlink") {
      try {
        fs.symlinkSync(fixture.databasePath, outputPath, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
    }

    expect(() => exportMigrationPackage({ databasePath: fixture.databasePath, outputPath })).toThrow("输出");
    expect(fileHash(fixture.databasePath)).toBe(before);
    const reopened = new DatabaseManager(getAppPaths(fixture.directory));
    expect(reopened.integrityCheck()).toBe("ok");
    reopened.close();
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

  it.each(["entity", "review"] as const)("rejects duplicate %s keys before Blob or database writes", async (kind) => {
    const { pkg } = exportFixture();
    if (kind === "entity") {
      pkg.collections.planItems.push(structuredClone(pkg.collections.planItems[0]));
      pkg.counts.planItems = { active: 2, deleted: 1, total: 3 };
    } else {
      pkg.dailyReviews.push(structuredClone(pkg.dailyReviews[0]));
    }
    resign(pkg);
    const database = new MemoryCloudDatabase();

    await expect(importCloudData({ pkg, database })).rejects.toThrow("重复");
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

  it.each(["entity-created", "entity-deleted", "review-key"] as const)("detects physical %s corruption hidden by intact JSON payloads", async (kind) => {
    const { pkg } = exportFixture();
    const database = new MemoryCloudDatabase();
    await importCloudData({ pkg, database });
    if (kind === "entity-created") database.entities.get("planItems:plan-active")!.created_at = "2026-08-15T00:00:00.000Z";
    if (kind === "entity-deleted") database.entities.get("planItems:plan-active")!.deleted_at = "2026-08-16T10:00:00.000Z";
    if (kind === "review-key") {
      const review = database.dailyReviews.get("2026-08-16")!;
      database.dailyReviews.delete("2026-08-16");
      database.dailyReviews.set("2026-08-17", review);
    }

    await expect(verifyCloudData({ pkg, queryable: database, log: vi.fn() })).rejects.toThrow("不一致");
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
    const uploader: MigrationUploader = migrationUploader(upload);

    expect(pkg.attachments).toEqual([expect.objectContaining({
      bookId: "book-with-pdf",
      kind: "pdf",
      fileId: "fixture.pdf",
      pathname: "reading/books/book-with-pdf/fixture.pdf",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })]);
    await expect(importCloudData({ pkg, database, uploader })).rejects.toThrow("附件目录");

    await importCloudData({ pkg, database, uploader, attachmentsDirectory: fixture.attachmentsDirectory });
    expect(upload).toHaveBeenCalledWith(
      "reading/books/book-with-pdf/fixture.pdf",
      expect.any(Buffer),
      { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/pdf" },
    );
    const book = database.entities.get("books:book-with-pdf")!.payload;
    expect(book.pdf_file_id).toBe("reading/books/book-with-pdf/fixture.pdf");
    const blob = {
      get: vi.fn(async () => ({ body: new ReadableStream<Uint8Array>(), contentType: "application/pdf" })),
      del: vi.fn(async () => undefined),
    };
    const manager = new CloudReadingFileManager({ get: vi.fn(async () => book) } as any, blob);
    await manager.readPdf("book-with-pdf");
    expect(blob.get).toHaveBeenCalledWith("reading/books/book-with-pdf/fixture.pdf", { access: "private" });
  });

  it("covers the sorted attachment manifest with the canonical package checksum", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    pkg.attachments[0].size += 1;
    const database = new MemoryCloudDatabase();

    await expect(importCloudData({ pkg, database, attachmentsDirectory: fixture.attachmentsDirectory })).rejects.toThrow("校验");
    expect(database.transactionCalls).toBe(0);
  });

  it("rejects attachment kind/content-type mismatches even when the package is re-signed", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    pkg.attachments[0].contentType = "image/png";
    resign(pkg);
    const database = new MemoryCloudDatabase();

    await expect(importCloudData({ pkg, database, attachmentsDirectory: fixture.attachmentsDirectory })).rejects.toThrow("附件");
    expect(database.transactionCalls).toBe(0);
  });

  it.each(["magic", "oversize", "symlink"] as const)("rejects %s attachment files before building a package", (kind) => {
    const fixture = createFixture({ attachment: true });
    const source = path.join(fixture.attachmentsDirectory, "fixture.pdf");
    if (kind === "magic") fs.writeFileSync(source, "not-a-pdf");
    if (kind === "oversize") {
      const handle = fs.openSync(source, "w");
      fs.writeSync(handle, Buffer.from("%PDF-"));
      fs.ftruncateSync(handle, 100 * 1024 * 1024 + 1);
      fs.closeSync(handle);
    }
    if (kind === "symlink") {
      const target = path.join(fixture.directory, "external.pdf");
      fs.writeFileSync(target, "%PDF-1.7\n%%EOF");
      fs.unlinkSync(source);
      try {
        fs.symlinkSync(target, source, "file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EPERM") return;
        throw error;
      }
    }

    expect(() => exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, `${kind}.json`),
      attachmentsDirectory: fixture.attachmentsDirectory,
    })).toThrow();
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
      pathname: "reading/books/book-with-pdf/missing.png",
      contentType: "image/png",
    });
    resign(pkg);
    const upload = vi.fn(async () => undefined);

    await expect(importCloudData({
      pkg,
      database: new MemoryCloudDatabase(),
      uploader: migrationUploader(upload),
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
    resign(pkg);
    const upload = vi.fn(async () => undefined);

    await expect(importCloudData({
      pkg,
      database: new MemoryCloudDatabase(),
      uploader: migrationUploader(upload),
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
    resign(pkg);
    const database = new MemoryCloudDatabase();

    await expect(importCloudData({ pkg, database, attachmentsDirectory: fixture.attachmentsDirectory })).rejects.toThrow("附件");
    expect(database.transactionCalls).toBe(0);
  });

  it("rolls back entity writes and durably tracks newly uploaded Blobs when the database transaction fails", async () => {
    const fixture = createFixture({ attachment: true });
    const pkg = exportMigrationPackage({
      databasePath: fixture.databasePath,
      outputPath: path.join(fixture.directory, "package.json"),
      attachmentsDirectory: fixture.attachmentsDirectory,
    });
    const database = new MemoryCloudDatabase();
    database.failTransaction = true;
    const upload = vi.fn(async () => undefined);

    await expect(importCloudData({
      pkg,
      database,
      uploader: migrationUploader(upload),
      attachmentsDirectory: fixture.attachmentsDirectory,
    })).rejects.toThrow("transaction failed");
    expect(database.entities.size).toBe(0);
    expect(database.blobCleanup.get("reading/books/book-with-pdf/fixture.pdf")).toMatchObject({
      reason: "migration-rollback",
      state: "pending",
    });
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

function resign(pkg: MigrationPackage): void {
  pkg.manifest.sha256 = calculatePackageHash(pkg);
}

function fileHash(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function migrationUploader(upload = vi.fn(async () => undefined)): MigrationUploader {
  return {
    upload,
    exists: vi.fn(async () => false),
    delete: vi.fn(async () => undefined),
  } as MigrationUploader;
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
  blobCleanup = new Map<string, { reason: string; state: string }>();
  transactionCalls = 0;
  failTransaction = false;
  queryCalls: Array<{ text: string; values: unknown[] }> = [];

  async transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const entities = structuredClone(this.entities);
    const settings = structuredClone(this.settings);
    const dailyReviews = structuredClone(this.dailyReviews);
    try {
      const result = await work(this);
      if (this.failTransaction) throw new Error("transaction failed");
      return result;
    } catch (error) {
      this.entities = entities;
      this.settings = settings;
      this.dailyReviews = dailyReviews;
      throw error;
    }
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
    if (text.includes("INSERT INTO workspace_blob_cleanup")) {
      const [pathname, reason] = values as [string, string];
      this.blobCleanup.set(pathname, { reason, state: "pending" });
      return { rows: [] };
    }
    if (text.includes("GROUP BY collection") && text.includes("jsonb_agg")) {
      const grouped = new Map<string, StoredEntity[]>();
      for (const row of this.entities.values()) grouped.set(row.collection, [...(grouped.get(row.collection) ?? []), row]);
      return {
        rows: [...grouped].sort(([left], [right]) => left.localeCompare(right)).map(([collection, rows]) => ({
          collection,
          items: rows.sort((left, right) => left.id.localeCompare(right.id)).map((row) => ({
            id: row.id,
            payload: structuredClone(row.payload),
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
          })),
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
          reviews: [...this.dailyReviews].sort(([left], [right]) => left.localeCompare(right)).map(([reviewDate, item]) => ({
            review_date: reviewDate,
            payload: structuredClone(item.payload),
            created_at: item.created_at,
            updated_at: item.updated_at,
          })),
        }] as T[],
      };
    }
    throw new Error(`Unexpected SQL in migration test: ${text}`);
  }
}
