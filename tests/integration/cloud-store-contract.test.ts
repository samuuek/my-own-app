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
});
