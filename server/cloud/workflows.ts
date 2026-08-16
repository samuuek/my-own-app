import {
  collectionDefinitions,
  sourceCollectionByType,
  type CollectionName,
} from "../collections.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { calculateReadingStats, validateBookProgress } from "../reading.js";
import { nextLocalDate, validateSourceCategory } from "../reflection.js";
import type { Entity } from "../store.js";
import type { CloudStore } from "./store.js";

export class CloudWorkflowService {
  constructor(private readonly store: CloudStore) {}

  async completePlan(id: string): Promise<Entity> {
    return this.store.transaction(async (store) => {
      const item = await store.get("planItems", id);
      const updated = await store.update("planItems", id, {
        status: "done",
        completed_at: new Date().toISOString(),
      });
      if (item.complete_source && item.source_entity_type && item.source_entity_id) {
        const collection = sourceCollectionByType[item.source_entity_type];
        if (collection && collectionDefinitions[collection].fields.includes("status" as never)) {
          await store.update(collection, item.source_entity_id, {
            status: collection === "workouts" ? "completed" : "done",
          });
        }
      }
      return updated;
    });
  }

  async recordReadingProgress(
    bookId: string,
    input: Entity,
  ): Promise<{ book: Entity; session: Entity; stats: Record<string, any>; suggestCompletion: boolean }> {
    return this.store.transaction(async (store) => {
      const book = await store.get("books", bookId);
      const startPage = Number(input.start_page);
      const endPage = Number(input.end_page);
      validateBookProgress(endPage, book.total_pages == null ? null : Number(book.total_pages));
      if (!Number.isInteger(startPage) || startPage < 0 || startPage > endPage) {
        throw new ValidationError("阅读起始页无效");
      }
      const session = await store.create("readingSessions", {
        ...input,
        book_id: bookId,
        start_page: startPage,
        end_page: endPage,
      });
      const updated = await store.update("books", bookId, {
        current_page: endPage,
        last_read_at: new Date().toISOString(),
      });
      const [sessions, notes] = await Promise.all([
        store.list("readingSessions"),
        store.list("readingNotes"),
      ]);
      return {
        book: updated,
        session,
        stats: calculateReadingStats(
          updated,
          sessions.filter((item) => item.book_id === bookId),
          notes.filter((item) => item.book_id === bookId),
        ),
        suggestCompletion: Number(updated.total_pages) === endPage,
      };
    });
  }

  async saveDailyReflection(input: Entity): Promise<{ reflection: Entity; actions: Entity[] }> {
    const date = String(input.reflection_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("复盘日期无效");
    validateSourceCategory(input.source_category);
    const actions = Array.isArray(input.actions) ? input.actions : [];
    return this.store.transaction(async (store) => {
      const existing = (await store.list("dailyReflections"))
        .find((item) => item.reflection_date === date);
      const fields = { ...input };
      delete fields.actions;
      const reflection = existing
        ? await store.update("dailyReflections", existing.id, fields)
        : await store.create("dailyReflections", fields);
      const retained = new Set<string>();
      for (const [index, action] of (actions as Entity[]).entries()) {
        const content = String(action.content ?? "").trim();
        if (!content) throw new ValidationError("明日行动不能为空");
        if (action.id) {
          const current = await store.get("reflectionActions", String(action.id), true);
          if (current.reflection_id !== reflection.id) throw new ValidationError("行动不属于当前复盘");
          const updated = await store.update("reflectionActions", current.id, { content, sort_order: index });
          retained.add(updated.id);
        } else {
          const created = await store.create("reflectionActions", {
            reflection_id: reflection.id,
            content,
            sort_order: index,
          });
          retained.add(created.id);
        }
      }
      const currentActions = (await store.list("reflectionActions"))
        .filter((item) => item.reflection_id === reflection.id);
      for (const current of currentActions) {
        if (!retained.has(current.id)) await store.softDelete("reflectionActions", current.id);
      }
      const savedActions = (await store.list("reflectionActions"))
        .filter((item) => item.reflection_id === reflection.id)
        .sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0));
      return { reflection, actions: savedActions };
    });
  }

  async addReflectionActionToPlan(actionId: string): Promise<Entity> {
    return this.store.transaction(async (store) => {
      const action = await store.get("reflectionActions", actionId);
      const reflection = await store.get("dailyReflections", action.reflection_id);
      if (action.plan_item_id) {
        try {
          return await store.get("planItems", action.plan_item_id);
        } catch (error) {
          if (!(error instanceof NotFoundError)) throw error;
        }
      }
      const plan = await store.create("planItems", {
        title: action.content,
        plan_date: nextLocalDate(reflection.reflection_date),
        priority: "medium",
        status: "todo",
        source_module: "reflection",
        source_entity_type: "reflection_action",
        source_entity_id: action.id,
      });
      await store.update("reflectionActions", action.id, { plan_item_id: plan.id });
      return plan;
    });
  }

  async postponePlan(id: string, date: string): Promise<Entity> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ValidationError("计划日期无效");
    return this.store.transaction((store) => store.update("planItems", id, {
      plan_date: date,
      status: "todo",
      completed_at: null,
    }));
  }

  async convertQuickMemo(id: string, collection: CollectionName, fields: Entity): Promise<Entity> {
    return this.store.transaction(async (store) => {
      const memo = await store.get("quickMemos", id);
      const titleField = collectionDefinitions[collection].title;
      const converted = await store.create(collection, {
        ...fields,
        [titleField]: fields[titleField] ?? memo.content,
      });
      await store.update("quickMemos", id, {
        converted_type: collection,
        converted_id: converted.id,
        archived_at: new Date().toISOString(),
      });
      return converted;
    });
  }
}
