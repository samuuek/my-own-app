// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/app.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";
import type { FastifyInstance } from "fastify";

let directory = "";
let app: FastifyInstance;

beforeEach(async () => {
  directory = makeTestDirectory("planning");
  app = await buildApp({ dataDir: directory, autoBackup: false });
});
afterEach(async () => {
  await app.close();
  removeTestDirectory(directory);
});

async function create(collection: string, payload: Record<string, any>) {
  const response = await app.inject({ method: "POST", url: `/api/collections/${collection}`, payload });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

describe("dashboard and daily planning", () => {
  it("separates timed and unscheduled items and updates progress after completion", async () => {
    const timed = await create("planItems", { title: "上午咨询", plan_date: "2026-08-02", start_time: "09:30", estimated_minutes: 60, priority: "high" });
    await create("planItems", { title: "整理笔记", plan_date: "2026-08-02", estimated_minutes: 30 });
    let dashboard = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-02" });
    expect(dashboard.json().data.timeline.map((item: any) => item.title)).toEqual(["上午咨询"]);
    expect(dashboard.json().data.unscheduled.map((item: any) => item.title)).toEqual(["整理笔记"]);
    expect(dashboard.json().data.overview).toMatchObject({ completed: 0, total: 2, scheduledMinutes: 90, progress: 0 });

    const completed = await app.inject({ method: "POST", url: `/api/plan-items/${timed.id}/complete` });
    expect(completed.statusCode).toBe(200);
    dashboard = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-02" });
    expect(dashboard.json().data.overview).toMatchObject({ completed: 1, total: 2, progress: 50 });
  });

  it("aggregates sorted important dates and long-term goals without a focus timer", async () => {
    await create("importantDates", { name: "后显示", target_date: "2026-08-20", recurrence: "none", color: "orange", sort_order: 2 });
    await create("importantDates", { name: "先显示", target_date: "2026-08-15", recurrence: "yearly", color: "blue", sort_order: 1 });
    await create("longTermGoals", { name: "第二目标", progress: 20, status: "active", sort_order: 2 });
    await create("longTermGoals", { name: "第一目标", progress: 60, status: "active", sort_order: 1 });

    const response = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-15" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ activeFocusTimer: null, sectionErrors: {} });
    expect(response.json().data.importantDates.map((item: any) => item.name)).toEqual(["先显示", "后显示"]);
    expect(response.json().data.importantDates[0]).toMatchObject({ displayDate: "2026-08-15", daysRemaining: 0, state: "today" });
    expect(response.json().data.longTermGoals.map((item: any) => item.name)).toEqual(["第一目标", "第二目标"]);
  });

  it("exposes one recoverable focus timer through the dashboard", async () => {
    const task = await create("planItems", { title: "专注测试", plan_date: "2026-08-15", estimated_minutes: 25 });
    const started = await app.inject({ method: "POST", url: "/api/focus-timers", payload: { planItemId: task.id, plannedMinutes: 25 } });
    expect(started.statusCode).toBe(201);
    expect(started.json().data).toMatchObject({ plan_item_id: task.id, status: "running" });

    const duplicate = await app.inject({ method: "POST", url: "/api/focus-timers", payload: { planItemId: null, plannedMinutes: 10 } });
    expect(duplicate.statusCode).toBe(400);

    let dashboard = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-15" });
    expect(dashboard.json().data.activeFocusTimer.id).toBe(started.json().data.id);

    const paused = await app.inject({ method: "POST", url: `/api/focus-timers/${started.json().data.id}/pause` });
    expect(paused.json().data.status).toBe("paused");
    const resumed = await app.inject({ method: "POST", url: `/api/focus-timers/${started.json().data.id}/resume` });
    expect(resumed.json().data.status).toBe("running");
    const finished = await app.inject({ method: "POST", url: `/api/focus-timers/${started.json().data.id}/finish`, payload: { status: "completed" } });
    expect(finished.json().data.status).toBe("completed");

    dashboard = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-15" });
    expect(dashboard.json().data.activeFocusTimer).toBeNull();
  });

  it("postpones items and saves the daily review", async () => {
    const item = await create("planItems", { title: "需要延期", plan_date: "2026-08-02" });
    const postponed = await app.inject({ method: "POST", url: `/api/plan-items/${item.id}/postpone`, payload: { date: "2026-08-03" } });
    expect(postponed.json().data).toMatchObject({ plan_date: "2026-08-03", status: "todo" });
    const review = await app.inject({ method: "PUT", url: "/api/daily-reviews/2026-08-02", payload: { content: "今天完成了关键功能" } });
    expect(review.statusCode).toBe(200);
    const loaded = await app.inject({ method: "GET", url: "/api/daily-reviews/2026-08-02" });
    expect(loaded.json().data.content).toBe("今天完成了关键功能");
  });

  it("resolves a linked record title live instead of keeping a stale duplicate", async () => {
    const media = await create("mediaContents", { title: "最初标题", stage: "producing" });
    await create("planItems", { title: "最初标题", plan_date: "2026-08-02", source_module: "media", source_entity_type: "media_content", source_entity_id: media.id });
    await app.inject({ method: "PATCH", url: `/api/collections/mediaContents/${media.id}`, payload: { title: "更新后的标题" } });
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-02" });
    expect(dashboard.json().data.unscheduled[0].display_title).toBe("更新后的标题");
    const state = await app.inject({ method: "GET", url: "/api/state" });
    expect(state.json().data.planItems[0]).toMatchObject({ display_title: "更新后的标题", source_module: "media", source_entity_id: media.id });
  });

  it("converts a quick memo into a linked workflow record and archives the memo", async () => {
    const memo = await create("quickMemos", { content: "做一期本地数据安全视频" });
    const converted = await app.inject({ method: "POST", url: `/api/quick-memos/${memo.id}/convert`, payload: { collection: "mediaContents", fields: { stage: "idea", platform: "B站" } } });
    expect(converted.statusCode).toBe(200);
    expect(converted.json().data).toMatchObject({ title: "做一期本地数据安全视频", stage: "idea", platform: "B站" });
    const state = await app.inject({ method: "GET", url: "/api/state" });
    expect(state.json().data.quickMemos[0].converted_id).toBe(converted.json().data.id);
    expect(state.json().data.quickMemos[0].archived_at).toBeTruthy();
  });
});
