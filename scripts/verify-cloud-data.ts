import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectionDefinitions, type CollectionName } from "../server/collections.js";
import { readCloudConfig } from "../server/cloud/config.js";
import { CloudDatabase, type Queryable } from "../server/cloud/database.js";
import {
  calculatePackageHash,
  readMigrationPackage,
  validateMigrationPackage,
  type MigrationCount,
  type MigrationEntity,
  type MigrationPackage,
} from "./export-cloud-data.js";

type VerificationOptions = {
  pkg: MigrationPackage;
  queryable: Queryable;
  log?: (line: string) => void;
};

type EntityAggregateRow = {
  collection: string;
  items: unknown;
};

type SettingsAggregateRow = {
  settings: unknown;
  setting_updated_at: unknown;
};

type ReviewAggregateRow = {
  reviews: unknown;
};

export type VerificationResult = {
  sha256: string;
  counts: Record<CollectionName, MigrationCount>;
};

const collectionNames = Object.keys(collectionDefinitions) as CollectionName[];

export async function verifyCloudData(options: VerificationOptions): Promise<VerificationResult> {
  const pkg = validateMigrationPackage(options.pkg);
  const log = options.log ?? console.log;
  const entityResult = await options.queryable.query<EntityAggregateRow>(`
    SELECT collection, COALESCE(jsonb_agg(payload ORDER BY id), '[]'::jsonb) AS items
    FROM workspace_entities
    GROUP BY collection
    ORDER BY collection
  `);
  const settingsResult = await options.queryable.query<SettingsAggregateRow>(`
    SELECT
      COALESCE(jsonb_object_agg(key, value ORDER BY key), '{}'::jsonb) AS settings,
      COALESCE(
        jsonb_object_agg(
          key,
          to_jsonb(to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ORDER BY key
        ),
        '{}'::jsonb
      ) AS setting_updated_at
    FROM workspace_settings
  `);
  const reviewsResult = await options.queryable.query<ReviewAggregateRow>(`
    SELECT COALESCE(jsonb_agg(payload ORDER BY review_date), '[]'::jsonb) AS reviews
    FROM workspace_daily_reviews
  `);

  const collections = Object.fromEntries(collectionNames.map((name) => [name, [] as MigrationEntity[]])) as unknown as Record<CollectionName, MigrationEntity[]>;
  for (const row of entityResult.rows) {
    if (!Object.hasOwn(collectionDefinitions, row.collection)) throw new Error("云端包含未知集合，核验不一致");
    const items = parseJsonValue(row.items);
    if (!Array.isArray(items)) throw new Error("云端集合聚合结果无效");
    collections[row.collection as CollectionName] = items as MigrationEntity[];
  }
  const settingsRow = settingsResult.rows[0];
  const reviewRow = reviewsResult.rows[0];
  const settings = parseRecord(settingsRow?.settings ?? {});
  const settingUpdatedAt = parseStringRecord(settingsRow?.setting_updated_at ?? {});
  const dailyReviews = parseArray(reviewRow?.reviews ?? []) as MigrationPackage["dailyReviews"];
  const counts = Object.fromEntries(collectionNames.map((name) => [name, countRows(collections[name])])) as Record<CollectionName, MigrationCount>;

  for (const name of collectionNames) {
    const count = counts[name];
    log(`${name} active=${count.active} deleted=${count.deleted} total=${count.total}`);
  }

  const countMismatch = collectionNames.some((name) => !sameCount(counts[name], pkg.counts[name]));
  const actualHash = calculatePackageHash({ collections, settings, settingUpdatedAt, dailyReviews });
  if (countMismatch || actualHash !== pkg.manifest.sha256) throw new Error("云端迁移核验不一致");
  return { sha256: actualHash, counts };
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("云端聚合结果无效");
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  const parsed = parseJsonValue(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("云端设置聚合结果无效");
  return parsed as Record<string, unknown>;
}

function parseStringRecord(value: unknown): Record<string, string> {
  const record = parseRecord(value);
  if (Object.values(record).some((item) => typeof item !== "string")) throw new Error("云端设置时间聚合结果无效");
  return record as Record<string, string>;
}

function parseArray(value: unknown): unknown[] {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) throw new Error("云端每日回顾聚合结果无效");
  return parsed;
}

function countRows(rows: MigrationEntity[]): MigrationCount {
  const deleted = rows.filter((row) => row.deleted_at !== null && row.deleted_at !== undefined).length;
  return { active: rows.length - deleted, deleted, total: rows.length };
}

function sameCount(left: MigrationCount, right: MigrationCount): boolean {
  return left.active === right.active && left.deleted === right.deleted && left.total === right.total;
}

function parseArguments(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`未知参数 ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`参数 ${argument} 缺少值`);
    result[argument.slice(2)] = value;
    index += 1;
  }
  return result;
}

export async function runVerifyCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArguments(argv);
  if (!args.input) throw new Error("必须指定迁移包路径");
  const config = readCloudConfig();
  await verifyCloudData({
    pkg: readMigrationPackage(args.input),
    queryable: new CloudDatabase(config.databaseUrl),
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runVerifyCli().catch(() => {
    process.exitCode = 1;
  });
}
