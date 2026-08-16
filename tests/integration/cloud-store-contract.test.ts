// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CloudStore } from "../../server/cloud/store.js";
import type { Queryable, QueryResult } from "../../server/cloud/database.js";

type JsonEntity = Record<string, any>;
type StoredEntity = {
  collection: string;
  id: string;
  payload: JsonEntity;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

class MemoryCloudDatabase implements Queryable {
  private entities = new Map<string, StoredEntity>();
  private settings = new Map<string, unknown>();
  private reviews = new Map<string, JsonEntity>();
  transactionCount = 0;

  seed(collection: string, payload: JsonEntity): void {
    this.entities.set(`${collection}:${payload.id}`, {
      collection,
      id: payload.id,
      payload: structuredClone(payload),
      createdAt: payload.created_at,
      updatedAt: payload.updated_at,
      deletedAt: payload.deleted_at ?? null,
    });
  }

  async transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return work(this);
  }

  async query<T>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (text.includes("COALESCE(MAX") && text.includes("AS next")) {
      const [collection, planDate] = values as [string, string];
      const current = [...this.entities.values()]
        .filter((row) => row.collection === collection && !row.deletedAt && row.payload.plan_date === planDate)
        .map((row) => Number(row.payload.sort_order))
        .filter(Number.isFinite);
      return { rows: [{ next: current.length ? Math.max(...current) + 1 : 0 }] as T[] };
    }

    if (text.includes("INSERT INTO workspace_entities")) {
      const [collection, id, rawPayload, createdAt, updatedAt] = values as [string, string, string, string, string];
      const payload = JSON.parse(rawPayload);
      this.entities.set(`${collection}:${id}`, { collection, id, payload, createdAt, updatedAt, deletedAt: null });
      return { rows: [{ payload: structuredClone(payload) }] as T[] };
    }

    if (text.includes("UPDATE workspace_entities")) {
      const [collection, id, rawPayload, updatedAt, deletedAt] = values as [string, string, string, string, string | null];
      const key = `${collection}:${id}`;
      const current = this.entities.get(key);
      if (!current) return { rows: [] };
      const payload = JSON.parse(rawPayload);
      this.entities.set(key, { ...current, payload, updatedAt, deletedAt });
      return { rows: [{ payload: structuredClone(payload) }] as T[] };
    }

    if (text.includes("DELETE FROM workspace_entities")) {
      const [collection, id] = values as [string, string];
      const key = `${collection}:${id}`;
      const row = this.entities.get(key);
      if (row?.deletedAt) this.entities.delete(key);
      return { rows: [] };
    }

    if (text.includes("FROM workspace_entities")) {
      const [collection, id] = values as [string, string | undefined];
      const includeDeleted = !text.includes("deleted_at IS NULL");
      const rows = [...this.entities.values()]
        .filter((row) => row.collection === collection && (id === undefined || row.id === id))
        .filter((row) => includeDeleted || !row.deletedAt)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((row) => ({ payload: structuredClone(row.payload) }));
      return { rows: rows as T[] };
    }

    if (text.includes("INSERT INTO workspace_settings")) {
      const [key, rawValue] = values as [string, string];
      this.settings.set(key, JSON.parse(rawValue));
      return { rows: [] };
    }
    if (text.includes("FROM workspace_settings")) {
      return { rows: [...this.settings].map(([key, value]) => ({ key, value: structuredClone(value) })) as T[] };
    }

    if (text.includes("INSERT INTO workspace_daily_reviews")) {
      const [date, rawPayload] = values as [string, string];
      const payload = JSON.parse(rawPayload);
      this.reviews.set(date, payload);
      return { rows: [{ payload: structuredClone(payload) }] as T[] };
    }
    if (text.includes("FROM workspace_daily_reviews")) {
      const row = this.reviews.get(String(values[0]));
      return { rows: row ? [{ payload: structuredClone(row) }] as T[] : [] };
    }

    throw new Error(`Unexpected SQL in memory contract: ${text}`);
  }
}

type TransactionContext = {
  locks: Set<string>;
  releases: Array<() => void>;
};

class ConcurrentCloudDatabase implements Queryable {
  private entities = new Map<string, StoredEntity>();
  private lockTails = new Map<string, Promise<void>>();
  private unlockedMaxWaiters = 0;
  private releaseUnlockedMax!: () => void;
  private readonly unlockedMaxBarrier = new Promise<void>((resolve) => { this.releaseUnlockedMax = resolve; });
  private unlockedReadWaiters = 0;
  private releaseUnlockedRead!: () => void;
  private readonly unlockedReadBarrier = new Promise<void>((resolve) => { this.releaseUnlockedRead = resolve; });

  seed(collection: string, payload: JsonEntity): void {
    this.entities.set(`${collection}:${payload.id}`, {
      collection,
      id: payload.id,
      payload: structuredClone(payload),
      createdAt: payload.created_at,
      updatedAt: payload.updated_at,
      deletedAt: payload.deleted_at ?? null,
    });
  }

  read(collection: string, id: string): JsonEntity | undefined {
    const payload = this.entities.get(`${collection}:${id}`)?.payload;
    return payload && structuredClone(payload);
  }

  async transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T> {
    const context: TransactionContext = { locks: new Set(), releases: [] };
    try {
      return await work({
        query: <Row>(text: string, values: unknown[] = []) => this.run<Row>(context, text, values),
      });
    } finally {
      for (const release of context.releases.reverse()) release();
    }
  }

  query<T>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    return this.run<T>(null, text, values);
  }

  private async run<T>(context: TransactionContext | null, text: string, values: unknown[]): Promise<QueryResult<T>> {
    if (text.includes("pg_advisory_xact_lock")) {
      if (!context) throw new Error("advisory transaction lock used outside a transaction");
      await this.acquire(context, `plan:${String(values[0])}:${String(values[1])}`);
      return { rows: [] };
    }

    if (text.includes("COALESCE(MAX") && text.includes("AS next")) {
      const [collection, planDate] = values as [string, string];
      const lockKey = `plan:${collection}:${planDate}`;
      if (!context?.locks.has(lockKey)) await this.waitForBothUnlockedMaxReaders();
      const current = [...this.entities.values()]
        .filter((row) => row.collection === collection && !row.deletedAt && row.payload.plan_date === planDate)
        .map((row) => Number(row.payload.sort_order))
        .filter(Number.isFinite);
      return { rows: [{ next: current.length ? Math.max(...current) + 1 : 0 }] as T[] };
    }

    if (text.includes("INSERT INTO workspace_entities")) {
      const [collection, id, rawPayload, createdAt, updatedAt] = values as [string, string, string, string, string];
      const payload = JSON.parse(rawPayload);
      this.entities.set(`${collection}:${id}`, { collection, id, payload, createdAt, updatedAt, deletedAt: null });
      return { rows: [{ payload: structuredClone(payload) }] as T[] };
    }

    if (text.includes("SELECT payload") && text.includes("FROM workspace_entities")) {
      const [collection, id] = values as [string, string];
      const lockKey = `row:${collection}:${id}`;
      if (text.includes("FOR UPDATE")) {
        if (!context) throw new Error("row lock used outside a transaction");
        await this.acquire(context, lockKey);
      } else if (!context?.locks.has(lockKey)) {
        await this.waitForBothUnlockedRowReaders();
      }
      const row = this.entities.get(`${collection}:${id}`);
      return { rows: row ? [{ payload: structuredClone(row.payload) }] as T[] : [] };
    }

    if (text.includes("UPDATE workspace_entities")) {
      const [collection, id, rawPayload, updatedAt, deletedAt] = values as [string, string, string, string, string | null];
      const key = `${collection}:${id}`;
      const current = this.entities.get(key);
      if (!current) return { rows: [] };
      const payload = JSON.parse(rawPayload);
      this.entities.set(key, { ...current, payload, updatedAt, deletedAt });
      return { rows: [{ payload: structuredClone(payload) }] as T[] };
    }

    throw new Error(`Unexpected concurrent SQL: ${text}`);
  }

  private async acquire(context: TransactionContext, key: string): Promise<void> {
    if (context.locks.has(key)) return;
    const previous = this.lockTails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.lockTails.set(key, previous.then(() => current));
    await previous;
    context.locks.add(key);
    context.releases.push(release);
  }

  private async waitForBothUnlockedMaxReaders(): Promise<void> {
    this.unlockedMaxWaiters += 1;
    if (this.unlockedMaxWaiters === 2) this.releaseUnlockedMax();
    await this.unlockedMaxBarrier;
  }

  private async waitForBothUnlockedRowReaders(): Promise<void> {
    this.unlockedReadWaiters += 1;
    if (this.unlockedReadWaiters === 2) this.releaseUnlockedRead();
    await this.unlockedReadBarrier;
  }
}

describe("CloudStore desktop-compatible contract", () => {
  it("creates, updates, deletes, restores, and permanently deletes entities", async () => {
    const database = new MemoryCloudDatabase();
    const store = new CloudStore(database);

    const created = await store.create("planItems", { title: "计划", plan_date: "2026-09-01" });
    const goal = await store.create("longTermGoals", { name: "目标", progress: 10 });
    expect((await store.update("longTermGoals", goal.id, { progress: 60 })).progress).toBe(60);

    const deleted = await store.softDelete("planItems", created.id);
    expect(deleted.deleted_at).toBeTruthy();
    expect(await store.list("planItems")).toEqual([]);
    expect(await store.list("planItems", true)).toHaveLength(1);
    expect(await store.trash()).toEqual([
      expect.objectContaining({ collection: "planItems", entity_id: created.id, display_title: "计划" }),
    ]);

    expect((await store.restore("planItems", created.id)).deleted_at).toBeNull();
    await store.softDelete("planItems", created.id);
    await store.permanentDelete("planItems", created.id);
    expect(await store.list("planItems", true)).toEqual([]);
  });

  it("hides reading and reflection children whose parent is deleted", async () => {
    const database = new MemoryCloudDatabase();
    const store = new CloudStore(database);
    const book = await store.create("books", { title: "书", total_pages: 100 });
    const session = await store.create("readingSessions", {
      book_id: book.id,
      session_date: "2026-09-01",
      start_page: 1,
      end_page: 5,
    });
    const note = await store.create("readingNotes", { book_id: book.id, note_date: "2026-09-01" });
    const reflection = await store.create("dailyReflections", {
      reflection_date: "2026-09-01",
      source_category: "life",
    });
    const action = await store.create("reflectionActions", { reflection_id: reflection.id, content: "继续" });

    await store.softDelete("books", book.id);
    await store.softDelete("dailyReflections", reflection.id);

    expect(await store.list("readingSessions")).toEqual([]);
    expect(await store.list("readingNotes")).toEqual([]);
    expect(await store.list("reflectionActions")).toEqual([]);
    expect(await store.list("readingSessions", true)).toEqual([session]);
    expect(await store.list("readingNotes", true)).toEqual([note]);
    expect(await store.list("reflectionActions", true)).toEqual([action]);
  });

  it("round-trips JSON settings and daily reviews", async () => {
    const store = new CloudStore(new MemoryCloudDatabase());

    expect(await store.setSettings({ appearance: "ios", shortcuts: ["today", "reading"] })).toEqual({
      appearance: "ios",
      shortcuts: ["today", "reading"],
    });
    expect(await store.getDailyReview("2026-09-01")).toBeNull();
    const review = await store.setDailyReview("2026-09-01", "今天完成了云端存储");
    expect(review).toMatchObject({ review_date: "2026-09-01", content: "今天完成了云端存储" });
    expect(await store.getDailyReview("2026-09-01")).toEqual(review);
  });

  it("builds complete state with resolved plan source titles", async () => {
    const store = new CloudStore(new MemoryCloudDatabase());
    const book = await store.create("books", { title: "云端阅读" });
    await store.create("planItems", {
      title: "阅读计划",
      plan_date: "2026-09-01",
      source_entity_type: "book",
      source_entity_id: book.id,
    });
    await store.setSettings({ appearance: "ios" });

    const state = await store.state();

    expect(Object.keys(state)).toContain("planItems");
    expect(Object.keys(state)).toContain("thoughtNotes");
    expect(state.settings).toEqual({ appearance: "ios" });
    expect(state.trash).toEqual([]);
    expect(state.planItems[0]).toMatchObject({ display_title: "云端阅读" });
  });

  it("searches case-insensitively in JavaScript and caps each collection at 20", async () => {
    const database = new MemoryCloudDatabase();
    const store = new CloudStore(database);
    const base = Date.parse("2026-09-01T00:00:00.000Z");
    for (let index = 0; index < 22; index += 1) {
      database.seed("books", {
        id: `book-${index}`,
        title: `Cloud Guide ${index}`,
        author: "Author",
        created_at: new Date(base + index * 1_000).toISOString(),
        updated_at: new Date(base + index * 1_000).toISOString(),
      });
    }
    await store.create("quickMemos", { content: "cloud reminder" });

    const results = await store.search("cLoUd");
    const books = results.filter((row) => row.collection === "books");

    expect(books).toHaveLength(20);
    expect(books[0]).toMatchObject({ collection: "books", module: "reading", title: "Cloud Guide 21", id: "book-21" });
    expect(results.some((row) => row.collection === "quickMemos" && row.title === "cloud reminder")).toBe(true);
  });

  it("serializes automatic plan ordering within one plan date", async () => {
    const store = new CloudStore(new ConcurrentCloudDatabase());

    const plans = await Promise.all([
      store.create("planItems", { title: "第一项", plan_date: "2026-09-01" }),
      store.create("planItems", { title: "第二项", plan_date: "2026-09-01" }),
    ]);

    expect(plans.map((plan) => plan.sort_order).sort((left, right) => left - right)).toEqual([0, 1]);
  });

  it("serializes read-modify-write updates for one entity without losing distinct fields", async () => {
    const database = new ConcurrentCloudDatabase();
    database.seed("longTermGoals", {
      id: "goal-1",
      name: "长期目标",
      progress: 0,
      notes: "旧备注",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      deleted_at: null,
    });
    const store = new CloudStore(database);

    await Promise.all([
      store.update("longTermGoals", "goal-1", { progress: 60 }),
      store.update("longTermGoals", "goal-1", { notes: "新备注" }),
    ]);

    expect(database.read("longTermGoals", "goal-1")).toMatchObject({ progress: 60, notes: "新备注" });
  });
});
