import { collectionDefinitions, sourceCollectionByType, type CollectionName } from "./collections.js";
import type { AppStore, Entity } from "./store.js";
import { resolveImportantDate } from "./workbench.js";
import type { FocusTimerSnapshot } from "./focus-timer.js";

export type DashboardCollections = Partial<Record<CollectionName, Entity[]>>;

export const dashboardCollectionNames = [
  "planItems",
  "consultingDeliverables",
  "consultingFollowups",
  "workouts",
  "mediaContents",
  "devWorkItems",
  "meals",
  "entertainmentItems",
  "books",
  "reflectionActions",
  "importantDates",
  "longTermGoals",
] as const satisfies readonly CollectionName[];

function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function rows(collections: DashboardCollections, name: CollectionName): Entity[] {
  return collections[name] ?? [];
}

function sourceTitle(collections: DashboardCollections, type: unknown, id: unknown): string | null {
  if (!type || !id) return null;
  const collection = sourceCollectionByType[String(type)];
  if (!collection) return null;
  const entity = rows(collections, collection).find((item) => item.id === id);
  return entity ? String(entity[collectionDefinitions[collection].title] ?? "") : null;
}

export function buildDashboardFromCollections(
  collections: DashboardCollections,
  date: string,
  activeFocusTimer: FocusTimerSnapshot | null,
): Record<string, any> {
  const planItems: Entity[] = rows(collections, "planItems").map((item): Entity => ({
    ...item,
    display_title: sourceTitle(collections, item.source_entity_type, item.source_entity_id) || item.title,
  }));
  const todayItems = planItems
    .filter((item) => item.plan_date === date && item.status !== "cancelled")
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)
      || String(a.start_time || "").localeCompare(String(b.start_time || "")));
  const timeline = todayItems.filter((item) => item.start_time);
  const unscheduled = todayItems.filter((item) => !item.start_time);
  const completed = todayItems.filter((item) => item.status === "done").length;
  const totalMinutes = todayItems.reduce((sum, item) => sum + Number(item.estimated_minutes || 0), 0);
  const horizon = plusDays(date, 3);

  const attention: Entity[] = [];
  attention.push(
    ...planItems
      .filter((item) => item.plan_date < date && !["done", "cancelled"].includes(item.status))
      .map((item) => ({ ...item, attention_type: "overdue", module: "today" })),
  );
  attention.push(
    ...rows(collections, "consultingDeliverables")
      .filter((item) => item.due_date && item.due_date <= horizon && item.status !== "done")
      .map((item) => ({ ...item, attention_type: "deliverable", module: "consulting" })),
  );
  attention.push(
    ...rows(collections, "consultingFollowups")
      .filter((item) => item.followup_at?.slice(0, 10) <= date && item.status !== "done")
      .map((item) => ({ ...item, attention_type: "followup", module: "consulting", title: item.content })),
  );
  attention.push(
    ...rows(collections, "workouts")
      .filter((item) => item.workout_date === date && item.status !== "completed")
      .map((item) => ({ ...item, attention_type: "workout", module: "fitness", title: item.name })),
  );

  const importantDates = [...rows(collections, "importantDates")]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item) => ({
      ...item,
      ...resolveImportantDate(item.target_date, item.recurrence ?? "none", date),
    }));
  const longTermGoals = [...rows(collections, "longTermGoals")]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

  return {
    date,
    overview: {
      completed,
      total: todayItems.length,
      progress: todayItems.length ? Math.round((completed / todayItems.length) * 100) : 0,
      scheduledMinutes: totalMinutes,
    },
    timeline,
    unscheduled,
    importantDates,
    longTermGoals,
    activeFocusTimer,
    sectionErrors: {},
    attention: attention.slice(0, 12),
    summaries: {
      media: rows(collections, "mediaContents").filter((item) => ["producing", "ready"].includes(item.stage)).slice(0, 3),
      development: rows(collections, "devWorkItems").filter((item) => item.priority === "high" && item.status !== "done").slice(0, 3),
      consulting: rows(collections, "consultingFollowups").filter((item) => item.status !== "done").slice(0, 3),
      fitness: rows(collections, "workouts").filter((item) => item.workout_date >= date).slice(0, 3),
      diet: rows(collections, "meals").filter((item) => item.meal_date === date).slice(0, 4),
      entertainment: rows(collections, "entertainmentItems").filter((item) => item.status === "playing").slice(0, 3),
    },
  };
}

export function buildDashboard(
  store: AppStore,
  date: string,
  readActiveFocusTimer: () => FocusTimerSnapshot | null = () => null,
): Record<string, any> {
  const collections: DashboardCollections = {};
  const sectionErrors: Record<string, string> = {};
  for (const name of dashboardCollectionNames) {
    try {
      collections[name] = store.list(name);
    } catch (error) {
      if (name !== "importantDates" && name !== "longTermGoals") throw error;
      sectionErrors[name] = error instanceof Error ? error.message : "数据不可用";
      collections[name] = [];
    }
  }
  let activeFocusTimer: FocusTimerSnapshot | null = null;
  try {
    activeFocusTimer = readActiveFocusTimer();
  } catch (error) {
    sectionErrors.focusTimer = error instanceof Error ? error.message : "数据不可用";
  }
  const dashboard = buildDashboardFromCollections(collections, date, activeFocusTimer);
  dashboard.sectionErrors = sectionErrors;
  return dashboard;
}
