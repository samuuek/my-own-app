// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CloudWorkflowService } from "../../server/cloud/workflows.js";
import type { CloudStore } from "../../server/cloud/store.js";
import type { CollectionName } from "../../server/collections.js";
import type { Entity } from "../../server/store.js";

type Collections = Partial<Record<CollectionName, Entity[]>>;

function cloneCollections(collections: Collections): Collections {
  return structuredClone(collections);
}

class TransactionHarness {
  collections: Collections;
  transactions = 0;
  rootOperations = 0;
  private nextId = 1;

  constructor(initial: Collections) {
    this.collections = cloneCollections(initial);
  }

  store(): CloudStore {
    const escaped = async () => {
      this.rootOperations += 1;
      throw new Error("dependent operation escaped transaction");
    };
    return {
      list: escaped,
      get: escaped,
      create: escaped,
      update: escaped,
      softDelete: escaped,
      transaction: async <T>(work: (store: CloudStore) => Promise<T>) => {
        this.transactions += 1;
        const working = cloneCollections(this.collections);
        const result = await work(this.boundStore(working));
        this.collections = working;
        return result;
      },
    } as unknown as CloudStore;
  }

  private boundStore(working: Collections): CloudStore {
    return {
      list: async (name: CollectionName, includeDeleted = false) => (working[name] ?? [])
        .filter((item) => includeDeleted || !item.deleted_at)
        .map((item) => ({ ...item })),
      get: async (name: CollectionName, id: string, includeDeleted = false) => {
        const row = (working[name] ?? []).find((item) => item.id === id && (includeDeleted || !item.deleted_at));
        if (!row) throw new Error("没有找到这条记录");
        return { ...row };
      },
      create: async (name: CollectionName, input: Entity) => {
        const row = {
          id: `${name}-${this.nextId++}`,
          ...input,
          created_at: "2026-08-15T00:00:00.000Z",
          updated_at: "2026-08-15T00:00:00.000Z",
          deleted_at: null,
        };
        (working[name] ??= []).unshift(row);
        return { ...row };
      },
      update: async (name: CollectionName, id: string, input: Entity) => {
        const index = (working[name] ?? []).findIndex((item) => item.id === id);
        if (index < 0) throw new Error("没有找到这条记录");
        working[name]![index] = { ...working[name]![index], ...input };
        return { ...working[name]![index] };
      },
      softDelete: async (name: CollectionName, id: string) => {
        const index = (working[name] ?? []).findIndex((item) => item.id === id);
        if (index < 0) throw new Error("没有找到这条记录");
        working[name]![index] = { ...working[name]![index], deleted_at: "2026-08-15T00:00:00.000Z" };
        return { ...working[name]![index] };
      },
    } as unknown as CloudStore;
  }
}

function expectSingleTransaction(harness: TransactionHarness): void {
  expect(harness.transactions).toBe(1);
  expect(harness.rootOperations).toBe(0);
}

describe("CloudWorkflowService", () => {
  it("completes a plan and its opted-in source in one transaction", async () => {
    const harness = new TransactionHarness({
      planItems: [{ id: "plan-1", title: "训练", plan_date: "2026-08-15", status: "todo", complete_source: true, source_entity_type: "workout", source_entity_id: "workout-1" }],
      workouts: [{ id: "workout-1", name: "力量训练", workout_date: "2026-08-15", status: "planned" }],
    });

    const completed = await new CloudWorkflowService(harness.store()).completePlan("plan-1");

    expect(completed).toMatchObject({ id: "plan-1", status: "done" });
    expect(completed.completed_at).toMatch(/^20\d\d-/);
    expect(harness.collections.workouts?.[0].status).toBe("completed");
    expectSingleTransaction(harness);
  });

  it("records reading progress and derives stats from transaction-visible rows", async () => {
    const harness = new TransactionHarness({
      books: [{ id: "book-1", title: "云端阅读", total_pages: 100, current_page: 10 }],
      readingSessions: [{ id: "old-session", book_id: "book-1", session_date: "2026-08-14", start_page: 1, end_page: 10, duration_minutes: 20 }],
      readingNotes: [{ id: "note-1", book_id: "book-1", note_date: "2026-08-14" }],
    });

    const result = await new CloudWorkflowService(harness.store()).recordReadingProgress("book-1", {
      session_date: "2026-08-15",
      start_page: 11,
      end_page: 100,
      duration_minutes: 40,
      notes: "完成",
    });

    expect(result.book).toMatchObject({ id: "book-1", current_page: 100 });
    expect(result.session).toMatchObject({ book_id: "book-1", start_page: 11, end_page: 100 });
    expect(result.stats).toMatchObject({ completion: 100, pagesRead: 100, minutesRead: 60, noteCount: 1 });
    expect(result.suggestCompletion).toBe(true);
    expectSingleTransaction(harness);
  });

  it("saves reflection actions atomically and removes omitted actions", async () => {
    const harness = new TransactionHarness({
      dailyReflections: [{ id: "reflection-1", reflection_date: "2026-08-15", source_category: "work" }],
      reflectionActions: [
        { id: "action-1", reflection_id: "reflection-1", content: "保留", sort_order: 0 },
        { id: "action-old", reflection_id: "reflection-1", content: "移除", sort_order: 1 },
      ],
    });

    const result = await new CloudWorkflowService(harness.store()).saveDailyReflection({
      reflection_date: "2026-08-15",
      source_category: "life",
      work_summary: "今日总结",
      actions: [{ id: "action-1", content: "更新后的行动" }, { content: "新增行动" }],
    });

    expect(result.reflection).toMatchObject({ id: "reflection-1", source_category: "life" });
    expect(result.actions.map((item) => item.content)).toEqual(["更新后的行动", "新增行动"]);
    expect(harness.collections.reflectionActions?.find((item) => item.id === "action-old")?.deleted_at).toBeTruthy();
    expectSingleTransaction(harness);
  });

  it("adds a reflection action to tomorrow's plan in one transaction", async () => {
    const harness = new TransactionHarness({
      dailyReflections: [{ id: "reflection-1", reflection_date: "2026-08-31", source_category: "work" }],
      reflectionActions: [{ id: "action-1", reflection_id: "reflection-1", content: "整理方案" }],
      planItems: [],
    });

    const plan = await new CloudWorkflowService(harness.store()).addReflectionActionToPlan("action-1");

    expect(plan).toMatchObject({ title: "整理方案", plan_date: "2026-09-01", source_entity_id: "action-1" });
    expect(harness.collections.reflectionActions?.[0].plan_item_id).toBe(plan.id);
    expectSingleTransaction(harness);
  });

  it("postpones a completed plan and clears its completion timestamp transactionally", async () => {
    const harness = new TransactionHarness({
      planItems: [{ id: "plan-1", title: "延期", plan_date: "2026-08-15", status: "done", completed_at: "2026-08-15T03:00:00.000Z" }],
    });

    const plan = await new CloudWorkflowService(harness.store()).postponePlan("plan-1", "2026-08-18");

    expect(plan).toMatchObject({ plan_date: "2026-08-18", status: "todo", completed_at: null });
    expectSingleTransaction(harness);
  });

  it("converts a memo and archives it together using the target title field", async () => {
    const harness = new TransactionHarness({
      quickMemos: [{ id: "memo-1", content: "做一期数据安全视频" }],
      mediaContents: [],
    });

    const converted = await new CloudWorkflowService(harness.store()).convertQuickMemo(
      "memo-1",
      "mediaContents",
      { platform: "B站", stage: "idea" },
    );

    expect(converted).toMatchObject({ title: "做一期数据安全视频", platform: "B站", stage: "idea" });
    expect(harness.collections.quickMemos?.[0]).toMatchObject({ converted_type: "mediaContents", converted_id: converted.id });
    expect(harness.collections.quickMemos?.[0].archived_at).toMatch(/^20\d\d-/);
    expectSingleTransaction(harness);
  });
});
