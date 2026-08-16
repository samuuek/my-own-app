import { randomUUID } from "node:crypto";
import {
  collectionDefinitions,
  sourceCollectionByType,
  type CollectionName,
} from "../collections.js";
import { NotFoundError } from "../errors.js";
import type { Entity } from "../store.js";
import type { Queryable } from "./database.js";
import {
  assertCollectionName,
  sanitizeCloudEntity,
  validateCloudCreate,
  validateCloudUpdate,
} from "./store-validation.js";

type PayloadRow = { payload: Entity | string };
type TransactionalQueryable = Queryable & {
  transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T>;
};

function supportsTransactions(queryable: Queryable): queryable is TransactionalQueryable {
  return "transaction" in queryable && typeof queryable.transaction === "function";
}

function readPayload(row: PayloadRow): Entity {
  return typeof row.payload === "string" ? JSON.parse(row.payload) as Entity : row.payload;
}

export class CloudStore {
  private readonly database: TransactionalQueryable | null;

  constructor(
    private readonly queryable: Queryable,
    database?: TransactionalQueryable | null,
    private readonly transactionBound = false,
  ) {
    this.database = database ?? (supportsTransactions(queryable) ? queryable : null);
  }

  async list(name: CollectionName, includeDeleted = false): Promise<Entity[]> {
    assertCollectionName(name);
    const result = await this.queryable.query<PayloadRow>(`
      SELECT payload
      FROM workspace_entities
      WHERE collection = $1${includeDeleted ? "" : " AND deleted_at IS NULL"}
      ORDER BY created_at DESC
    `, [name]);
    const rows = result.rows.map(readPayload);

    if (includeDeleted) return rows;
    if (name === "readingSessions" || name === "readingNotes") {
      return this.filterVisibleChildren(rows, "book_id", "books");
    }
    if (name === "reflectionActions") {
      return this.filterVisibleChildren(rows, "reflection_id", "dailyReflections");
    }
    return rows;
  }

  async get(name: CollectionName, id: string, includeDeleted = false): Promise<Entity> {
    assertCollectionName(name);
    const result = await this.queryable.query<PayloadRow>(`
      SELECT payload
      FROM workspace_entities
      WHERE collection = $1 AND id = $2${includeDeleted ? "" : " AND deleted_at IS NULL"}
      LIMIT 1
    `, [name, id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("没有找到这条记录");
    return readPayload(row);
  }

  async create(name: CollectionName, input: Entity): Promise<Entity> {
    assertCollectionName(name);
    const clean = sanitizeCloudEntity(name, input);
    validateCloudCreate(name, clean);

    if (name === "planItems" && clean.sort_order === undefined) {
      if (!this.transactionBound) return this.transaction((store) => store.create(name, input));
      await this.queryable.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
        [name, String(clean.plan_date)],
      );
      const result = await this.queryable.query<{ next: number | string }>(`
        SELECT COALESCE(MAX((payload->>'sort_order')::integer), -1) + 1 AS next
        FROM workspace_entities
        WHERE collection = $1 AND payload->>'plan_date' = $2 AND deleted_at IS NULL
      `, [name, clean.plan_date]);
      clean.sort_order = Number(result.rows[0]?.next ?? 0);
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const payload: Entity = {
      id,
      ...clean,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    const result = await this.queryable.query<PayloadRow>(`
      INSERT INTO workspace_entities(collection, id, payload, created_at, updated_at, deleted_at)
      VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, NULL)
      RETURNING payload
    `, [name, id, JSON.stringify(payload), now, now]);
    return readPayload(result.rows[0]);
  }

  async update(name: CollectionName, id: string, input: Entity): Promise<Entity> {
    assertCollectionName(name);
    if (!this.transactionBound) return this.transaction((store) => store.update(name, id, input));
    const existing = await this.getForUpdate(name, id, true);
    const clean = sanitizeCloudEntity(name, input);
    validateCloudUpdate(name, existing, clean);
    const payload = {
      ...existing,
      ...clean,
      id,
      updated_at: new Date().toISOString(),
    };
    return this.replacePayload(name, id, payload);
  }

  async softDelete(name: CollectionName, id: string): Promise<Entity> {
    assertCollectionName(name);
    return this.transaction(async (store) => {
      const existing = await store.getForUpdate(name, id);
      const now = new Date().toISOString();
      return store.replacePayload(name, id, { ...existing, id, updated_at: now, deleted_at: now });
    });
  }

  async restore(name: CollectionName, id: string): Promise<Entity> {
    assertCollectionName(name);
    return this.transaction(async (store) => {
      const existing = await store.getForUpdate(name, id, true);
      const now = new Date().toISOString();
      return store.replacePayload(name, id, { ...existing, id, updated_at: now, deleted_at: null });
    });
  }

  async permanentDelete(name: CollectionName, id: string): Promise<void> {
    assertCollectionName(name);
    await this.queryable.query(`
      DELETE FROM workspace_entities
      WHERE collection = $1 AND id = $2 AND deleted_at IS NOT NULL
    `, [name, id]);
  }

  async trash(): Promise<Entity[]> {
    const collections = Object.keys(collectionDefinitions) as CollectionName[];
    const rows = (await Promise.all(collections.map(async (name) => {
      const definition = collectionDefinitions[name];
      const entities = await this.list(name, true);
      return entities
        .filter((entity) => entity.deleted_at)
        .map((entity) => ({
          id: `trash:${name}:${entity.id}`,
          collection: name,
          entity_id: entity.id,
          display_title: String(entity[definition.title] ?? "未命名记录"),
          deleted_at: entity.deleted_at,
        }));
    }))).flat();
    return rows.sort((left, right) => String(right.deleted_at).localeCompare(String(left.deleted_at)));
  }

  async getSettings(): Promise<Record<string, any>> {
    const result = await this.queryable.query<{ key: string; value: unknown }>(`
      SELECT key, value
      FROM workspace_settings
      ORDER BY key
    `);
    return Object.fromEntries(result.rows.map((row) => [row.key, row.value]));
  }

  async setSettings(input: Record<string, any>): Promise<Record<string, any>> {
    await this.transaction(async (store) => {
      const now = new Date().toISOString();
      for (const [key, value] of Object.entries(input)) {
        await store.queryable.query(`
          INSERT INTO workspace_settings(key, value, updated_at)
          VALUES ($1, $2::jsonb, $3::timestamptz)
          ON CONFLICT(key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at
        `, [key, JSON.stringify(value ?? null), now]);
      }
    });
    return this.getSettings();
  }

  async getDailyReview(date: string): Promise<Entity | null> {
    const result = await this.queryable.query<PayloadRow>(`
      SELECT payload
      FROM workspace_daily_reviews
      WHERE review_date = $1::date
      LIMIT 1
    `, [date]);
    return result.rows[0] ? readPayload(result.rows[0]) : null;
  }

  async setDailyReview(date: string, content: string): Promise<Entity> {
    const existing = await this.getDailyReview(date);
    const now = new Date().toISOString();
    const payload: Entity = {
      review_date: date,
      content,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    const result = await this.queryable.query<PayloadRow>(`
      INSERT INTO workspace_daily_reviews(review_date, payload, created_at, updated_at)
      VALUES ($1::date, $2::jsonb, $3::timestamptz, $4::timestamptz)
      ON CONFLICT(review_date) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_at = EXCLUDED.updated_at
      RETURNING payload
    `, [date, JSON.stringify(payload), payload.created_at, now]);
    return readPayload(result.rows[0]);
  }

  async state(): Promise<Record<string, any>> {
    const names = Object.keys(collectionDefinitions) as CollectionName[];
    const values = await Promise.all(names.map((name) => this.list(name)));
    const collections = Object.fromEntries(names.map((name, index) => [name, values[index]]));
    collections.planItems = await Promise.all((collections.planItems as Entity[]).map(async (item) => ({
      ...item,
      display_title: await this.sourceTitle(item.source_entity_type, item.source_entity_id) || item.title,
    })));
    return {
      ...collections,
      settings: await this.getSettings(),
      trash: await this.trash(),
    };
  }

  async search(query: string): Promise<Entity[]> {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    const results: Entity[] = [];
    for (const [name, definition] of Object.entries(collectionDefinitions) as Array<[
      CollectionName,
      (typeof collectionDefinitions)[CollectionName],
    ]>) {
      if (definition.search.length === 0) continue;
      const matching = (await this.list(name))
        .filter((row) => definition.search.some((field) => String(row[field] ?? "").toLocaleLowerCase().includes(normalized)))
        .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at)))
        .slice(0, 20)
        .map((row) => ({
          id: row.id,
          title: row[definition.title],
          updated_at: row.updated_at,
          collection: name,
          module: definition.module,
        }));
      results.push(...matching);
    }
    return results;
  }

  async sourceTitle(type: string | null, id: string | null): Promise<string | null> {
    if (!type || !id) return null;
    const collection = sourceCollectionByType[type];
    if (!collection) return null;
    try {
      const row = await this.get(collection, id);
      return String(row[collectionDefinitions[collection].title] ?? "");
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  }

  async transaction<T>(work: (store: CloudStore) => Promise<T>): Promise<T> {
    if (this.transactionBound) return work(this);
    if (!this.database) throw new Error("CloudStore transaction requires CloudDatabase");
    return this.database.transaction((queryable) => work(new CloudStore(queryable, this.database, true)));
  }

  private async filterVisibleChildren(
    rows: Entity[],
    foreignKey: string,
    parentCollection: CollectionName,
  ): Promise<Entity[]> {
    const visibleParents = new Set((await this.list(parentCollection)).map((row) => String(row.id)));
    return rows.filter((row) => visibleParents.has(String(row[foreignKey])));
  }

  async getForUpdate(name: CollectionName, id: string, includeDeleted = false): Promise<Entity> {
    assertCollectionName(name);
    if (!this.transactionBound) throw new Error("CloudStore.getForUpdate requires an active transaction");
    const result = await this.queryable.query<PayloadRow>(`
      SELECT payload
      FROM workspace_entities
      WHERE collection = $1 AND id = $2${includeDeleted ? "" : " AND deleted_at IS NULL"}
      FOR UPDATE
    `, [name, id]);
    const row = result.rows[0];
    if (!row) throw new NotFoundError("没有找到这条记录");
    return readPayload(row);
  }

  private async replacePayload(name: CollectionName, id: string, payload: Entity): Promise<Entity> {
    const result = await this.queryable.query<PayloadRow>(`
      UPDATE workspace_entities
      SET payload = $3::jsonb,
          updated_at = $4::timestamptz,
          deleted_at = $5::timestamptz
      WHERE collection = $1 AND id = $2
      RETURNING payload
    `, [name, id, JSON.stringify(payload), payload.updated_at, payload.deleted_at ?? null]);
    if (!result.rows[0]) throw new NotFoundError("没有找到这条记录");
    return readPayload(result.rows[0]);
  }
}
