import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { put } from "@vercel/blob";
import { collectionDefinitions, type CollectionName } from "../server/collections.js";
import { readCloudConfig } from "../server/cloud/config.js";
import { CloudDatabase, type Queryable } from "../server/cloud/database.js";
import {
  readMigrationPackage,
  validateMigrationPackage,
  type MigrationAttachment,
  type MigrationCount,
  type MigrationPackage,
} from "./export-cloud-data.js";

export type MigrationCloudDatabase = Queryable & {
  transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T>;
};

type PrivateUploadOptions = {
  access: "private";
  addRandomSuffix: false;
  allowOverwrite: true;
  contentType: string;
};

export type MigrationUploader = {
  upload(pathname: string, content: Buffer, options: PrivateUploadOptions): Promise<void>;
};

export type ImportCloudDataOptions = {
  pkg: MigrationPackage;
  database: MigrationCloudDatabase;
  uploader?: MigrationUploader;
  attachmentsDirectory?: string;
  dryRun?: boolean;
};

export type ImportCloudDataResult = {
  dryRun: boolean;
  counts: Record<CollectionName, MigrationCount>;
  settings: number;
  dailyReviews: number;
  attachments: number;
};

const collectionNames = Object.keys(collectionDefinitions) as CollectionName[];
const defaultUploader: MigrationUploader = {
  upload: async (pathname, content, options) => {
    await put(pathname, content, options);
  },
};

export async function importCloudData(options: ImportCloudDataOptions): Promise<ImportCloudDataResult> {
  const pkg = validateMigrationPackage(options.pkg);
  const result: ImportCloudDataResult = {
    dryRun: options.dryRun === true,
    counts: pkg.counts,
    settings: Object.keys(pkg.settings).length,
    dailyReviews: pkg.dailyReviews.length,
    attachments: pkg.attachments.length,
  };
  if (options.dryRun) return result;

  if (pkg.attachments.length > 0) {
    if (!options.attachmentsDirectory) throw new Error("迁移包包含附件；必须显式指定附件目录");
    await uploadAttachments(pkg.attachments, options.attachmentsDirectory, options.uploader ?? defaultUploader);
  }

  await options.database.transaction(async (transaction) => {
    for (const name of collectionNames) {
      for (const entity of pkg.collections[name]) {
        await transaction.query(`
          INSERT INTO workspace_entities(collection, id, payload, created_at, updated_at, deleted_at)
          VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6::timestamptz)
          ON CONFLICT(collection, id) DO UPDATE SET
            payload = EXCLUDED.payload,
            created_at = EXCLUDED.created_at,
            updated_at = EXCLUDED.updated_at,
            deleted_at = EXCLUDED.deleted_at
        `, [name, entity.id, JSON.stringify(entity), entity.created_at, entity.updated_at, entity.deleted_at]);
      }
    }

    for (const key of Object.keys(pkg.settings).sort()) {
      await transaction.query(`
        INSERT INTO workspace_settings(key, value, updated_at)
        VALUES ($1, $2::jsonb, $3::timestamptz)
        ON CONFLICT(key) DO UPDATE SET
          value = EXCLUDED.value,
          updated_at = EXCLUDED.updated_at
      `, [key, JSON.stringify(pkg.settings[key] ?? null), pkg.settingUpdatedAt[key]]);
    }

    for (const review of pkg.dailyReviews) {
      await transaction.query(`
        INSERT INTO workspace_daily_reviews(review_date, payload, created_at, updated_at)
        VALUES ($1::date, $2::jsonb, $3::timestamptz, $4::timestamptz)
        ON CONFLICT(review_date) DO UPDATE SET
          payload = EXCLUDED.payload,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at
      `, [review.review_date, JSON.stringify(review), review.created_at, review.updated_at]);
    }
  });
  return result;
}

async function uploadAttachments(
  attachments: MigrationAttachment[],
  attachmentsDirectory: string,
  uploader: MigrationUploader,
): Promise<void> {
  const root = path.resolve(attachmentsDirectory);
  const prepared = attachments.map((attachment) => {
    if (path.basename(attachment.fileId) !== attachment.fileId) throw new Error("附件路径无效");
    const sourcePath = path.resolve(root, attachment.fileId);
    if (path.dirname(sourcePath) !== root) throw new Error("附件路径超出显式目录");
    const content = fs.readFileSync(sourcePath);
    if (content.byteLength !== attachment.size || sha256(content) !== attachment.sha256) {
      throw new Error(`附件校验失败：${attachment.fileId}`);
    }
    return { attachment, content };
  });
  for (const { attachment, content } of prepared) {
    await uploader.upload(`reading/books/${attachment.bookId}/${attachment.fileId}`, content, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: attachment.contentType,
    });
  }
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
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

function printResult(result: ImportCloudDataResult): void {
  for (const name of collectionNames) {
    const count = result.counts[name];
    console.log(`${name} active=${count.active} deleted=${count.deleted} total=${count.total}`);
  }
  console.log(`settings total=${result.settings}`);
  console.log(`dailyReviews total=${result.dailyReviews}`);
  console.log(`attachments total=${result.attachments}`);
  if (result.dryRun) console.log("dry-run no-write");
}

export async function runImportCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  const inputPath = typeof args.input === "string" ? args.input : "";
  if (!inputPath) throw new Error("必须指定迁移包路径");
  const pkg = readMigrationPackage(inputPath);
  if (args.dryRun === true) {
    const result = await importCloudData({ pkg, database: noWriteDatabase, dryRun: true });
    printResult(result);
    return;
  }
  const config = readCloudConfig();
  const database = new CloudDatabase(config.databaseUrl);
  const result = await importCloudData({
    pkg,
    database,
    attachmentsDirectory: typeof args.attachments === "string" ? args.attachments : undefined,
  });
  printResult(result);
}

const noWriteDatabase: MigrationCloudDatabase = {
  query: async () => {
    throw new Error("dry-run 禁止数据库写入");
  },
  transaction: async () => {
    throw new Error("dry-run 禁止数据库事务");
  },
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runImportCli().catch((error) => {
    console.error(error instanceof Error ? error.message : "迁移导入失败");
    process.exitCode = 1;
  });
}
