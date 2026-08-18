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
  pathname: string;
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

type CanonicalMigrationContent = Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews" | "attachments">;

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
  assertDistinctOutput(databasePath, outputPath);
  const sourceHashBefore = hashFile(databasePath);
  let collections!: Record<CollectionName, MigrationEntity[]>;
  let settings!: Record<string, unknown>;
  let settingUpdatedAt!: Record<string, string>;
  let dailyReviews!: MigrationPackage["dailyReviews"];
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(database.pragma("integrity_check", { simple: true }));
    if (integrity !== "ok") throw new Error("SQLite 备份完整性检查失败");

    collections = Object.fromEntries(collectionNames.map((name) => {
      const table = collectionDefinitions[name].table;
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as MigrationEntity[];
      return [name, rows.map(normalizeEntity)];
    })) as Record<CollectionName, MigrationEntity[]>;

    const settingRows = database.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all() as Array<{
      key: string;
      value: string;
      updated_at: string;
    }>;
    settings = {};
    settingUpdatedAt = {};
    for (const row of settingRows) {
      settings[row.key] = parseSetting(row.value);
      settingUpdatedAt[row.key] = row.updated_at;
    }

    dailyReviews = (database.prepare("SELECT * FROM daily_reviews ORDER BY review_date").all() as MigrationPackage["dailyReviews"])
      .map((row) => ({ ...row }));
  } finally {
    database.close();
  }
  const attachments = collectAttachments(collections.books, options.attachmentsDirectory);
  assertAttachmentOutputSafety(attachments, options.attachmentsDirectory, outputPath);
  verifyAttachmentSources(attachments, options.attachmentsDirectory);
  applyCloudAttachmentPaths(collections.books, attachments);
  if (hashFile(databasePath) !== sourceHashBefore) throw new Error("SQLite 备份在导出期间发生变化，已停止迁移");
  const counts = Object.fromEntries(collectionNames.map((name) => [name, countRows(collections[name])])) as Record<CollectionName, MigrationCount>;
  const pkg: MigrationPackage = {
    manifest: {
      formatVersion: 1,
      sourceIntegrity: "ok",
      exportedAt: (options.now ?? (() => new Date()))().toISOString(),
      sha256: "",
    },
    collections,
    settings,
    settingUpdatedAt,
    dailyReviews,
    counts,
    attachments,
  };
  pkg.manifest.sha256 = calculatePackageHash(pkg);
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    assertDistinctOutput(databasePath, outputPath);
    assertAttachmentOutputSafety(attachments, options.attachmentsDirectory, outputPath);
    fs.writeFileSync(outputPath, `${JSON.stringify(pkg, null, 2)}\n`, { encoding: "utf8", flag: "w" });
    if (hashFile(databasePath) !== sourceHashBefore) throw new Error("SQLite 备份在导出期间发生变化，已停止迁移");
    verifyAttachmentSources(attachments, options.attachmentsDirectory);
  }
  return pkg;
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
    const ids = new Set<string>();
    for (const row of rows) {
      validateEntity(name, row);
      if (ids.has(row.id)) throw new Error(`迁移包集合 ${name} 包含重复实体 ID`);
      ids.add(row.id);
    }
    const expected = countRows(rows as MigrationEntity[]);
    if (!sameCount(input.counts[name], expected)) throw new Error(`迁移包集合 ${name} 计数无效`);
  }
  const settings = input.settings;
  const settingUpdatedAt = input.settingUpdatedAt;
  for (const [key, updatedAt] of Object.entries(settingUpdatedAt)) {
    if (!Object.hasOwn(settings, key) || typeof updatedAt !== "string") throw new Error("迁移包设置时间无效");
  }
  if (Object.keys(settings).some((key) => typeof settingUpdatedAt[key] !== "string")) throw new Error("迁移包设置时间无效");
  const reviewDates = new Set<string>();
  for (const review of input.dailyReviews) {
    validateDailyReview(review);
    const reviewDate = (review as { review_date: string }).review_date;
    if (reviewDates.has(reviewDate)) throw new Error("迁移包包含重复每日回顾日期");
    reviewDates.add(reviewDate);
  }
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

export function calculatePackageHash(pkg: Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews" | "attachments">): string {
  return sha256(canonicalJson(canonicalMigrationContent(pkg)));
}

export function canonicalMigrationContent(
  input: Pick<MigrationPackage, "collections" | "settings" | "settingUpdatedAt" | "dailyReviews" | "attachments">,
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
    attachments: [...input.attachments].map((item) => stableValue(item)).sort((left, right) => String(left.pathname).localeCompare(String(right.pathname))),
  };
}

function collectAttachments(books: MigrationEntity[], attachmentsDirectory?: string): MigrationAttachment[] {
  const references = books.flatMap((book) => ([
    attachmentReference(book, "pdf"),
    attachmentReference(book, "cover"),
  ].filter((item): item is { bookId: string; kind: "pdf" | "cover"; fileId: string; filename: string } => item !== null)));
  if (references.length === 0) return [];
  if (!attachmentsDirectory) throw new Error("备份包含阅读附件；必须显式指定附件目录");
  return references.map((reference) => {
    const contentType = attachmentContentType(reference.kind, reference.fileId);
    const inspected = readValidatedAttachment({
      attachmentsDirectory,
      fileId: reference.fileId,
      kind: reference.kind,
      contentType,
    });
    return {
      ...reference,
      pathname: cloudAttachmentPath(reference.bookId, reference.fileId, inspected.sha256),
      size: inspected.content.byteLength,
      sha256: inspected.sha256,
      contentType,
    };
  }).sort((left, right) => left.pathname.localeCompare(right.pathname));
}

function assertAttachmentOutputSafety(
  attachments: MigrationAttachment[],
  attachmentsDirectory: string | undefined,
  outputPath: string,
): void {
  if (attachments.length === 0) return;
  if (!attachmentsDirectory) throw new Error("迁移附件目录无效");
  for (const attachment of attachments) {
    assertDistinctOutput(path.resolve(attachmentsDirectory, attachment.fileId), outputPath);
  }
}

function verifyAttachmentSources(attachments: MigrationAttachment[], attachmentsDirectory?: string): void {
  if (attachments.length === 0) return;
  if (!attachmentsDirectory) throw new Error("迁移附件目录无效");
  for (const attachment of attachments) {
    readValidatedAttachment({
      attachmentsDirectory,
      fileId: attachment.fileId,
      kind: attachment.kind,
      contentType: attachment.contentType,
      expectedSize: attachment.size,
      expectedSha256: attachment.sha256,
    });
  }
}

export function readValidatedAttachment(options: {
  attachmentsDirectory: string;
  fileId: string;
  kind: "pdf" | "cover";
  contentType: string;
  expectedSize?: number;
  expectedSha256?: string;
}): { content: Buffer; sha256: string } {
  if (!isSafePathSegment(options.fileId)) throw new Error("附件标识包含不安全路径");
  if (options.contentType !== attachmentContentType(options.kind, options.fileId)) throw new Error("附件类型与文件格式不一致");
  const root = path.resolve(options.attachmentsDirectory);
  const rootInfo = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("附件目录不能是符号链接或联接目录");
  const realRoot = fs.realpathSync.native(root);
  const sourcePath = path.resolve(root, options.fileId);
  const sourceInfo = fs.lstatSync(sourcePath, { throwIfNoEntry: false });
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) throw new Error(`迁移附件不是普通文件：${options.fileId}`);
  const realSource = fs.realpathSync.native(sourcePath);
  if (path.dirname(realSource) !== realRoot) throw new Error("附件路径超出显式目录");

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = fs.openSync(sourcePath, flags);
  try {
    const openedInfo = fs.fstatSync(handle);
    const maximum = options.kind === "pdf" ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (openedInfo.size <= 0 || openedInfo.size > maximum) throw new Error(options.kind === "pdf" ? "PDF 文件不能超过 100 MB" : "封面图片不能超过 10 MB");
    if (options.expectedSize !== undefined && openedInfo.size !== options.expectedSize) throw new Error(`附件校验失败：${options.fileId}`);
    const content = Buffer.allocUnsafe(openedInfo.size);
    let offset = 0;
    while (offset < content.byteLength) {
      const bytesRead = fs.readSync(handle, content, offset, content.byteLength - offset, offset);
      if (bytesRead === 0) throw new Error(`附件读取不完整：${options.fileId}`);
      offset += bytesRead;
    }
    assertAttachmentMagic(options.kind, options.contentType, content.subarray(0, 16));
    const digest = sha256(content);
    if (options.expectedSha256 !== undefined && digest !== options.expectedSha256) throw new Error(`附件校验失败：${options.fileId}`);
    const afterRead = fs.fstatSync(handle);
    if (afterRead.size !== openedInfo.size || afterRead.mtimeMs !== openedInfo.mtimeMs) throw new Error(`附件在读取期间发生变化：${options.fileId}`);
    return { content, sha256: digest };
  } finally {
    fs.closeSync(handle);
  }
}

function assertAttachmentMagic(kind: "pdf" | "cover", contentType: string, prefix: Buffer): void {
  const startsWith = (...bytes: number[]) => bytes.every((byte, index) => prefix[index] === byte);
  const valid = kind === "pdf"
    ? startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)
    : contentType === "image/png"
      ? startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
      : contentType === "image/jpeg"
        ? startsWith(0xff, 0xd8, 0xff)
        : startsWith(0x52, 0x49, 0x46, 0x46) && prefix[8] === 0x57 && prefix[9] === 0x45 && prefix[10] === 0x42 && prefix[11] === 0x50;
  if (!valid) throw new Error(kind === "pdf" ? "请选择有效的 PDF 文件" : "请选择有效的 PNG、JPEG 或 WebP 封面图片");
}

function applyCloudAttachmentPaths(books: MigrationEntity[], attachments: MigrationAttachment[]): void {
  const byId = new Map(books.map((book) => [book.id, book]));
  for (const attachment of attachments) {
    const book = byId.get(attachment.bookId);
    if (!book || book[`${attachment.kind}_file_id`] !== attachment.fileId) throw new Error("迁移附件与书籍记录不一致");
    book[`${attachment.kind}_file_id`] = attachment.pathname;
  }
}

function cloudAttachmentPath(bookId: string, fileId: string, digest: string): string {
  if (!isSafePathSegment(bookId) || !isSafePathSegment(fileId)) throw new Error("迁移附件路径无效");
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("迁移附件校验值无效");
  return `reading/books/${bookId}/${digest}${path.extname(fileId).toLowerCase()}`;
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
  const extension = path.extname(fileId).toLowerCase();
  if (kind === "pdf" && extension === ".pdf") return "application/pdf";
  if (kind === "pdf") throw new Error("PDF 附件格式无效");
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
    || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)
    || typeof value.pathname !== "string" || value.pathname !== cloudAttachmentPath(value.bookId, value.fileId, value.sha256)
    || typeof value.size !== "number"
    || typeof value.contentType !== "string" || value.contentType !== attachmentContentType(value.kind, value.fileId)) {
    throw new Error("迁移包附件清单无效");
  }
}

function validateAttachmentManifest(books: MigrationEntity[], attachments: MigrationAttachment[]): void {
  const referenced = books.flatMap((book) => (["pdf", "cover"] as const).flatMap((kind) => {
    const pathname = book[`${kind}_file_id`];
    return typeof pathname === "string" && pathname ? [{ bookId: book.id, kind, pathname }] : [];
  }));
  if (attachments.length !== referenced.length) throw new Error("迁移包附件清单与书籍记录不一致");
  const remaining = new Set(attachments.map((item) => item.pathname));
  if (remaining.size !== attachments.length) throw new Error("迁移包附件清单包含重复记录");
  for (const reference of referenced) {
    const attachment = attachments.find((item) => item.pathname === reference.pathname && item.bookId === reference.bookId && item.kind === reference.kind);
    if (!attachment || !remaining.delete(attachment.pathname)) throw new Error("迁移包附件清单与书籍记录不一致");
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

function hashFile(filePath: string): string {
  const handle = fs.openSync(filePath, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let position = 0;
    while (true) {
      const bytesRead = fs.readSync(handle, buffer, 0, buffer.byteLength, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    return hash.digest("hex");
  } finally {
    fs.closeSync(handle);
  }
}

function assertDistinctOutput(databasePath: string, outputPath: string): void {
  const sourceRealPath = fs.realpathSync.native(databasePath);
  const destinationRealPath = resolveProspectiveRealPath(outputPath);
  if (samePath(sourceRealPath, destinationRealPath)) throw new Error("迁移包输出路径不能覆盖 SQLite 备份");

  const outputInfo = fs.lstatSync(outputPath, { throwIfNoEntry: false });
  if (!outputInfo) return;
  if (outputInfo.isSymbolicLink()) throw new Error("迁移包输出路径不能是符号链接或联接");
  const sourceInfo = fs.statSync(databasePath);
  const destinationInfo = fs.statSync(outputPath);
  if (sameFileIdentity(sourceInfo, destinationInfo) || samePath(sourceRealPath, fs.realpathSync.native(outputPath))) {
    throw new Error("迁移包输出文件不能与 SQLite 备份共享文件身份");
  }
}

function resolveProspectiveRealPath(candidate: string): string {
  const missingSegments: string[] = [];
  let existing = candidate;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("迁移包输出路径无效");
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  const info = fs.lstatSync(existing);
  if (!info.isDirectory() && missingSegments.length > 0) throw new Error("迁移包输出目录无效");
  return path.join(fs.realpathSync.native(existing), ...missingSegments);
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino !== 0 && left.ino === right.ino;
}

function samePath(left: string, right: string): boolean {
  const normalize = process.platform === "win32" ? (value: string) => value.toLocaleLowerCase() : (value: string) => value;
  return normalize(path.normalize(left)) === normalize(path.normalize(right));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
