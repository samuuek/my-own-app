import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { collectionDefinitions, type CollectionName } from "../server/collections.js";

export type MigrationEntity = Record<string, unknown> & {
  id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type MigrationCount = {
  active: number;
  deleted: number;
  total: number;
};

export type MigrationAttachment = {
  bookId: string;
  kind: "pdf" | "cover";
  fileId: string;
  filename: string;
  size: number;
  sha256: string;
  contentType: string;
};

export type MigrationPackage = {
  manifest: {
    formatVersion: 1;
    sourceIntegrity: "ok";
    exportedAt: string;
    sha256: string;
  };
  collections: Record<CollectionName, MigrationEntity[]>;
  settings: Record<string, unknown>;
  settingUpdatedAt: Record<string, string>;
  dailyReviews: Array<Record<string, unknown> & {
    review_date: string;
    created_at: string;
    updated_at: string;
  }>;
  counts: Record<CollectionName, MigrationCount>;
  attachments: MigrationAttachment[];
};

type CanonicalMigrationContent = Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews">;

export type ExportMigrationOptions = {
  databasePath: string;
  outputPath: string;
  attachmentsDirectory?: string;
  dryRun?: boolean;
  now?: () => Date;
};

const collectionNames = Object.keys(collectionDefinitions) as CollectionName[];

export function exportMigrationPackage(options: ExportMigrationOptions): MigrationPackage {
  const databasePath = path.resolve(requireNonEmpty(options.databasePath, "必须指定 SQLite 备份路径"));
  const outputPath = path.resolve(requireNonEmpty(options.outputPath, "必须指定迁移包输出路径"));
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(database.pragma("integrity_check", { simple: true }));
    if (integrity !== "ok") throw new Error("SQLite 备份完整性检查失败");

    const collections = Object.fromEntries(collectionNames.map((name) => {
      const table = collectionDefinitions[name].table;
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as MigrationEntity[];
      return [name, rows.map(normalizeEntity)];
    })) as Record<CollectionName, MigrationEntity[]>;

    const settingRows = database.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    const settings: Record<string, unknown> = {};
    const settingUpdatedAt: Record<string, string> = {};
    for (const row of settingRows) {
      settings[row.key] = parseSetting(row.value);
      settingUpdatedAt[row.key] = row.updated_at;
    }

    const dailyReviews = (database.prepare("SELECT * FROM daily_reviews ORDER BY review_date").all() as MigrationPackage["dailyReviews"])
      .map((row) => ({ ...row }));
    const canonicalContent = canonicalMigrationContent({ collections, settings, settingUpdatedAt, dailyReviews });
    const attachments = collectAttachments(collections.books, options.attachmentsDirectory);
    const counts = Object.fromEntries(collectionNames.map((name) => [name, countRows(collections[name])])) as Record<CollectionName, MigrationCount>;
    const pkg: MigrationPackage = {
      manifest: {
        formatVersion: 1,
        sourceIntegrity: "ok",
        exportedAt: (options.now ?? (() => new Date()))().toISOString(),
        sha256: sha256(canonicalJson(canonicalContent)),
      },
      collections,
      settings,
      settingUpdatedAt,
      dailyReviews,
      counts,
      attachments,
    };
    if (!options.dryRun) {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(pkg, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    }
    return pkg;
  } finally {
    database.close();
  }
}

export function readMigrationPackage(inputPath: string): MigrationPackage {
  const input = JSON.parse(fs.readFileSync(path.resolve(requireNonEmpty(inputPath, "必须指定迁移包路径")), "utf8")) as unknown;
  return validateMigrationPackage(input);
}

export function validateMigrationPackage(input: unknown): MigrationPackage {
  if (!isRecord(input) || !isRecord(input.manifest)) throw new Error("迁移包格式无效");
  if (input.manifest.formatVersion !== 1) throw new Error("迁移包版本不受支持");
  if (input.manifest.sourceIntegrity !== "ok") throw new Error("迁移包来源完整性无效");
  if (!isRecord(input.collections) || !isRecord(input.settings) || !isRecord(input.settingUpdatedAt)) throw new Error("迁移包内容无效");
  if (!Array.isArray(input.dailyReviews) || !Array.isArray(input.attachments) || !isRecord(input.counts)) throw new Error("迁移包内容无效");

  for (const name of collectionNames) {
    const rows = input.collections[name];
    if (!Array.isArray(rows)) throw new Error(`迁移包缺少集合 ${name}`);
    for (const row of rows) validateEntity(name, row);
    const expected = countRows(rows as MigrationEntity[]);
    if (!sameCount(input.counts[name], expected)) throw new Error(`迁移包集合 ${name} 计数无效`);
  }
  const settings = input.settings;
  const settingUpdatedAt = input.settingUpdatedAt;
  for (const [key, updatedAt] of Object.entries(settingUpdatedAt)) {
    if (!Object.hasOwn(settings, key) || typeof updatedAt !== "string") throw new Error("迁移包设置时间无效");
  }
  if (Object.keys(settings).some((key) => typeof settingUpdatedAt[key] !== "string")) throw new Error("迁移包设置时间无效");
  for (const review of input.dailyReviews) validateDailyReview(review);
  for (const attachment of input.attachments) validateAttachment(attachment);
  validateAttachmentManifest(
    input.collections.books as MigrationEntity[],
    input.attachments as MigrationAttachment[],
  );
  if (typeof input.manifest.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.manifest.sha256)) throw new Error("迁移包校验值无效");

  const pkg = input as MigrationPackage;
  const actualHash = calculatePackageHash(pkg);
  if (actualHash !== pkg.manifest.sha256) throw new Error("迁移包校验失败，内容可能已被修改");
  return pkg;
}

export function calculatePackageHash(pkg: Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews">): string {
  return sha256(canonicalJson(canonicalMigrationContent(pkg)));
}

export function canonicalMigrationContent(
  input: Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews">,
): CanonicalMigrationContent {
  const collections = Object.fromEntries(collectionNames.map((name) => [
    name,
    [...input.collections[name]].map((row) => stableValue(row)).sort((left, right) => String(left.id).localeCompare(String(right.id))),
  ])) as Record<CollectionName, MigrationEntity[]>;
  return {
    collections,
    settings: stableValue(input.settings),
    settingUpdatedAt: stableValue(input.settingUpdatedAt) as Record<string, string>,
    dailyReviews: [...input.dailyReviews].map((row) => stableValue(row)).sort((left, right) => String(left.review_date).localeCompare(String(right.review_date))),
  };
}

function collectAttachments(books: MigrationEntity[], attachmentsDirectory?: string): MigrationAttachment[] {
  const references = books.flatMap((book) => ([
    attachmentReference(book, "pdf"),
    attachmentReference(book, "cover"),
  ].filter((item): item is { bookId: string; kind: "pdf" | "cover"; fileId: string; filename: string } => item !== null)));
  if (references.length === 0) return [];
  if (!attachmentsDirectory) throw new Error("备份包含阅读附件；必须显式指定附件目录");
  const root = path.resolve(attachmentsDirectory);
  return references.map((reference) => {
    if (path.basename(reference.fileId) !== reference.fileId) throw new Error("附件标识包含不安全路径");
    const sourcePath = path.resolve(root, reference.fileId);
    if (!isDirectChild(root, sourcePath)) throw new Error("附件路径超出显式目录");
    const stat = fs.statSync(sourcePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`迁移附件不存在：${reference.fileId}`);
    const content = fs.readFileSync(sourcePath);
    return {
      ...reference,
      size: content.byteLength,
      sha256: sha256(content),
      contentType: attachmentContentType(reference.kind, reference.fileId),
    };
  }).sort((left, right) => `${left.bookId}:${left.kind}`.localeCompare(`${right.bookId}:${right.kind}`));
}

function attachmentReference(book: MigrationEntity, kind: "pdf" | "cover") {
  const fileId = book[`${kind}_file_id`];
  if (fileId === null || fileId === undefined || fileId === "") return null;
  if (typeof fileId !== "string") throw new Error("阅读附件标识无效");
  return {
    bookId: book.id,
    kind,
    fileId,
    filename: typeof book[`${kind}_filename`] === "string" ? String(book[`${kind}_filename`]) : fileId,
  };
}

function attachmentContentType(kind: "pdf" | "cover", fileId: string): string {
  if (kind === "pdf") return "application/pdf";
  const extension = path.extname(fileId).toLowerCase();
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  throw new Error("封面附件格式无效");
}

function normalizeEntity(row: MigrationEntity): MigrationEntity {
  return { ...row, deleted_at: row.deleted_at ?? null };
}

function countRows(rows: MigrationEntity[]): MigrationCount {
  const deleted = rows.filter((row) => row.deleted_at !== null && row.deleted_at !== undefined).length;
  return { active: rows.length - deleted, deleted, total: rows.length };
}

function validateEntity(name: CollectionName, value: unknown): asserts value is MigrationEntity {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) throw new Error(`迁移包集合 ${name} 包含无效记录`);
  if (typeof value.created_at !== "string" || typeof value.updated_at !== "string") throw new Error(`迁移包集合 ${name} 时间戳无效`);
  if (value.deleted_at !== null && typeof value.deleted_at !== "string") throw new Error(`迁移包集合 ${name} 删除状态无效`);
}

function validateDailyReview(value: unknown): void {
  if (!isRecord(value) || typeof value.review_date !== "string" || typeof value.created_at !== "string" || typeof value.updated_at !== "string") {
    throw new Error("迁移包每日回顾无效");
  }
}

function validateAttachment(value: unknown): void {
  if (!isRecord(value) || typeof value.bookId !== "string" || !isSafePathSegment(value.bookId) || (value.kind !== "pdf" && value.kind !== "cover")
    || typeof value.fileId !== "string" || !isSafePathSegment(value.fileId) || typeof value.filename !== "string"
    || typeof value.size !== "number" || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.contentType !== "string") {
    throw new Error("迁移包附件清单无效");
  }
}

function validateAttachmentManifest(books: MigrationEntity[], attachments: MigrationAttachment[]): void {
  const expected = books.flatMap((book) => ([
    attachmentReference(book, "pdf"),
    attachmentReference(book, "cover"),
  ].filter((item): item is { bookId: string; kind: "pdf" | "cover"; fileId: string; filename: string } => item !== null)));
  if (attachments.length !== expected.length) throw new Error("迁移包附件清单与书籍记录不一致");
  const remaining = new Set(attachments.map((item) => `${item.bookId}:${item.kind}:${item.fileId}`));
  if (remaining.size !== attachments.length) throw new Error("迁移包附件清单包含重复记录");
  for (const reference of expected) {
    if (!isSafePathSegment(reference.bookId) || !isSafePathSegment(reference.fileId)) throw new Error("迁移包附件路径无效");
    const key = `${reference.bookId}:${reference.kind}:${reference.fileId}`;
    if (!remaining.delete(key)) throw new Error("迁移包附件清单与书籍记录不一致");
  }
  if (remaining.size > 0) throw new Error("迁移包附件清单与书籍记录不一致");
}

function sameCount(value: unknown, expected: MigrationCount): boolean {
  return isRecord(value) && value.active === expected.active && value.deleted === expected.deleted && value.total === expected.total;
}

function parseSetting(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function stableValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => stableValue(item)) as T;
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])])) as T;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDirectChild(root: string, candidate: string): boolean {
  return path.dirname(candidate) === root;
}

function isSafePathSegment(value: string): boolean {
  return value.length > 0
    && value !== "."
    && value !== ".."
    && path.basename(value) === value
    && ![...value].some((character) => character.charCodeAt(0) < 32);
}

function requireNonEmpty(value: string, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value;
}

function parseArguments(argv: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument.startsWith("--")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`参数 ${argument} 缺少值`);
      result[argument.slice(2)] = value;
      index += 1;
    } else throw new Error(`未知参数 ${argument}`);
  }
  return result;
}

function printCounts(pkg: MigrationPackage): void {
  for (const name of collectionNames) {
    const count = pkg.counts[name];
    console.log(`${name} active=${count.active} deleted=${count.deleted} total=${count.total}`);
  }
}

export function runExportCli(argv: string[] = process.argv.slice(2)): void {
  const args = parseArguments(argv);
  const pkg = exportMigrationPackage({
    databasePath: String(args.database ?? ""),
    outputPath: String(args.output ?? ""),
    attachmentsDirectory: typeof args.attachments === "string" ? args.attachments : undefined,
    dryRun: args.dryRun === true,
  });
  console.log(`integrity ${pkg.manifest.sourceIntegrity}`);
  console.log(`sha256 ${pkg.manifest.sha256}`);
  printCounts(pkg);
  if (args.dryRun === true) console.log("dry-run no-write");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    runExportCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "迁移导出失败");
    process.exitCode = 1;
  }
}
