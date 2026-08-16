// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDashboardFromCollections } from "../../server/dashboard.js";
import { buildCloudDashboard } from "../../server/cloud/dashboard.js";
import type { CloudStore } from "../../server/cloud/store.js";
import type { CollectionName } from "../../server/collections.js";
import type { Entity } from "../../server/store.js";

const date = "2026-08-15";

describe("cloud dashboard", () => {
  it("assembles the same overview and sections from plain collections", () => {
    const timer = {
      id: "timer-1",
      status: "running",
      remainingSeconds: 1200,
      actualSeconds: null,
      snapshotAt: "2026-08-15T01:05:00.000Z",
    };
    const dashboard = buildDashboardFromCollections({
      planItems: [
        { id: "plan-2", title: "未排期", plan_date: date, status: "todo", estimated_minutes: 30, sort_order: 2 },
        { id: "plan-1", title: "已完成", plan_date: date, status: "done", start_time: "09:00", estimated_minutes: 60, sort_order: 1 },
      ],
      importantDates: [{ id: "date-1", name: "纪念日", target_date: date, recurrence: "yearly", sort_order: 1 }],
      longTermGoals: [{ id: "goal-1", name: "年度目标", progress: 40, status: "active", sort_order: 1 }],
    }, date, timer as never);

    expect(dashboard.overview).toEqual({ completed: 1, total: 2, progress: 50, scheduledMinutes: 90 });
    expect(dashboard.timeline.map((item: Entity) => item.title)).toEqual(["已完成"]);
    expect(dashboard.unscheduled.map((item: Entity) => item.title)).toEqual(["未排期"]);
    expect(dashboard.importantDates[0]).toMatchObject({ displayDate: date, daysRemaining: 0, state: "today" });
    expect(dashboard.longTermGoals.map((item: Entity) => item.name)).toEqual(["年度目标"]);
    expect(dashboard.activeFocusTimer).toBe(timer);
  });

  it("isolates optional section failures while retaining core dashboard data", async () => {
    const store = {
      list: async (name: CollectionName) => {
        if (name === "importantDates") throw new Error("dates unavailable");
        if (name === "longTermGoals") throw new Error("goals unavailable");
        if (name === "planItems") return [{
          id: "plan-1",
          title: "旧书名",
          plan_date: date,
          status: "todo",
          sort_order: 0,
          source_entity_type: "book",
          source_entity_id: "book-1",
        }];
        if (name === "books") return [{ id: "book-1", title: "云端新书名" }];
        return [];
      },
    } as unknown as CloudStore;
    const focusTimers = { current: async () => { throw new Error("timer unavailable"); } };

    const dashboard = await buildCloudDashboard(store, date, focusTimers);

    expect(dashboard.unscheduled[0].display_title).toBe("云端新书名");
    expect(dashboard.importantDates).toEqual([]);
    expect(dashboard.longTermGoals).toEqual([]);
    expect(dashboard.activeFocusTimer).toBeNull();
    expect(dashboard.sectionErrors).toEqual({
      importantDates: "dates unavailable",
      longTermGoals: "goals unavailable",
      focusTimer: "timer unavailable",
    });
  });

  it("does not reorder caller-owned collection arrays", () => {
    const importantDates = [
      { id: "date-2", name: "第二项", target_date: "2026-08-20", recurrence: "none", sort_order: 2 },
      { id: "date-1", name: "第一项", target_date: "2026-08-18", recurrence: "none", sort_order: 1 },
    ];

    buildDashboardFromCollections({ importantDates }, date, null);

    expect(importantDates.map((item) => item.id)).toEqual(["date-2", "date-1"]);
  });
});
