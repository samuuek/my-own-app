// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CloudStore } from "../../server/cloud/store.js";
import type { Queryable, QueryResult } from "../../server/cloud/database.js";

type QueryCall = { text: string; values: unknown[] };
type Responder = (text: string, values: unknown[]) => QueryResult<unknown>;

class RecordingDatabase implements Queryable {
  readonly rootCalls: QueryCall[] = [];
  readonly transactionCalls: QueryCall[] = [];
  transactions = 0;

  constructor(private readonly respond: Responder) {}

  async query<T>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
    this.rootCalls.push({ text, values });
    return this.respond(text, values) as QueryResult<T>;
  }

  async transaction<T>(work: (queryable: Queryable) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const queryable: Queryable = {
      query: async <Row>(text: string, values: unknown[] = []) => {
        this.transactionCalls.push({ text, values });
        return this.respond(text, values) as QueryResult<Row>;
      },
    };
    return work(queryable);
  }
}

function payloadResult(values: unknown[]): QueryResult<unknown> {
  return { rows: [{ payload: JSON.parse(String(values[2])) }] };
}

describe("CloudStore validation and JSONB persistence", () => {
  it("strips unknown fields and rejects a create missing its real required field", async () => {
    const database = new RecordingDatabase(() => ({ rows: [] }));
    const store = new CloudStore(database);

    await expect(store.create("importantDates", {
      title: "纪念日",
      target_date: "2026-09-01",
    })).rejects.toThrow("name");
    expect(database.rootCalls).toHaveLength(0);
  });

  it("persists an id-consistent payload with ISO timestamps using parameters", async () => {
    const database = new RecordingDatabase((text, values) => {
      if (text.includes("INSERT INTO workspace_entities")) return payloadResult(values);
      return { rows: [] };
    });
    const store = new CloudStore(database);

    const created = await store.create("importantDates", {
      name: "  纪念日  ",
      target_date: "2026-09-01",
      ignored: "must not persist",
    });

    expect(created.name).toBe("纪念日");
    expect(created).not.toHaveProperty("ignored");
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(created.created_at)).not.toBeNaN();
    expect(Date.parse(created.updated_at)).not.toBeNaN();
    expect(created.created_at).toBe(new Date(created.created_at).toISOString());
    expect(created.updated_at).toBe(new Date(created.updated_at).toISOString());

    const insert = database.rootCalls.find((call) => call.text.includes("INSERT INTO workspace_entities"));
    expect(insert?.text).toContain("VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, NULL)");
    expect(insert?.values[0]).toBe("importantDates");
    expect(insert?.values[1]).toBe(created.id);
    expect(JSON.parse(String(insert?.values[2]))).toMatchObject({ id: created.id, name: "纪念日" });
  });

  it("assigns the next active sort order for the same plan date", async () => {
    const database = new RecordingDatabase((text, values) => {
      if (text.includes("AS next")) return { rows: [{ next: 4 }] };
      if (text.includes("INSERT INTO workspace_entities")) return payloadResult(values);
      return { rows: [] };
    });
    const store = new CloudStore(database);

    const plan = await store.create("planItems", { title: "下一项", plan_date: "2026-09-01" });

    expect(plan.sort_order).toBe(4);
    const orderQuery = database.rootCalls.find((call) => call.text.includes("AS next"));
    expect(orderQuery?.values).toEqual(["planItems", "2026-09-01"]);
    expect(orderQuery?.text).toContain("deleted_at IS NULL");
  });

  it("replaces a merged full payload and duplicates updated metadata in one statement", async () => {
    const existing = {
      id: "goal-1",
      name: "长期目标",
      progress: 10,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
      deleted_at: null,
    };
    const database = new RecordingDatabase((text, values) => {
      if (text.includes("SELECT payload")) return { rows: [{ payload: existing }] };
      if (text.includes("UPDATE workspace_entities")) return payloadResult(values);
      return { rows: [] };
    });
    const store = new CloudStore(database);

    const updated = await store.update("longTermGoals", "goal-1", { progress: 60, unknown: true });

    expect(updated).toMatchObject({ id: "goal-1", name: "长期目标", progress: 60 });
    expect(updated).not.toHaveProperty("unknown");
    const update = database.rootCalls.find((call) => call.text.includes("UPDATE workspace_entities"));
    expect(update?.text).toContain("payload = $3::jsonb");
    expect(update?.text).toContain("updated_at = $4::timestamptz");
    expect(update?.text).toContain("deleted_at = $5::timestamptz");
    expect(JSON.parse(String(update?.values[2]))).toEqual(updated);
  });

  it("rejects an invalid collection before issuing SQL", async () => {
    const database = new RecordingDatabase(() => ({ rows: [] }));
    const store = new CloudStore(database);

    await expect(store.list("unsafe_table" as never)).rejects.toThrow("collection");
    expect(database.rootCalls).toHaveLength(0);
  });
});

describe("CloudStore transaction binding", () => {
  it("runs soft-delete metadata changes on the transaction queryable", async () => {
    const active = {
      id: "plan-1",
      title: "计划",
      plan_date: "2026-09-01",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    };
    const database = new RecordingDatabase((text, values) => {
      if (text.includes("SELECT payload")) return { rows: [{ payload: active }] };
      if (text.includes("UPDATE workspace_entities")) return payloadResult(values);
      return { rows: [] };
    });
    const store = new CloudStore(database);

    const deleted = await store.softDelete("planItems", "plan-1");

    expect(database.transactions).toBe(1);
    expect(database.transactionCalls.some((call) => call.text.includes("UPDATE workspace_entities"))).toBe(true);
    expect(database.rootCalls).toHaveLength(0);
    expect(deleted.deleted_at).toMatch(/^2026-|^20\d\d-/);
  });

  it("binds callback operations to the database transaction", async () => {
    const database = new RecordingDatabase((text, values) => {
      if (text.includes("INSERT INTO workspace_entities")) return payloadResult(values);
      return { rows: [] };
    });
    const store = new CloudStore(database);

    await store.transaction((transactionStore) => transactionStore.create("quickMemos", { content: "事务中" }));

    expect(database.transactions).toBe(1);
    expect(database.transactionCalls.some((call) => call.text.includes("INSERT INTO workspace_entities"))).toBe(true);
    expect(database.rootCalls).toHaveLength(0);
  });
});
