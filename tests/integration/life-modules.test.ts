// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
let app: FastifyInstance;
beforeEach(async () => { directory = makeTestDirectory("life-modules"); app = await buildApp({ dataDir: directory, autoBackup: false }); });
afterEach(async () => { await app.close(); removeTestDirectory(directory); });

async function create(collection: string, payload: Record<string, any>) {
  const response = await app.inject({ method: "POST", url: `/api/collections/${collection}`, payload });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

describe("specialized life modules", () => {
  it("keeps workout templates separate from actual exercise sets and body history", async () => {
    const template = await create("workoutTemplates", { name: "上肢力量", body_part: "胸部与背部", weekday: 2, notes: "稳步加重" });
    const templateExercise = await create("workoutTemplateExercises", { template_id: template.id, name: "卧推", target_sets: 3, target_reps: 8, target_weight: 50, rest_seconds: 120, sort_order: 0 });
    const workout = await create("workouts", { template_id: template.id, name: "上肢力量", body_part: template.body_part, workout_date: "2026-08-02", status: "in_progress", started_at: "2026-08-02T16:00:00.000Z" });
    const exercise = await create("workoutExercises", { workout_id: workout.id, name: "卧推", sort_order: 0 });
    const set = await create("workoutSets", { workout_exercise_id: exercise.id, set_number: 1, reps: 8, weight: 52.5, completed: 1 });
    await create("bodyMetrics", { metric_date: "2026-08-02", weight: 72.4, waist: 81.2, notes: "晨起" });
    await app.inject({ method: "PATCH", url: `/api/collections/workoutTemplateExercises/${templateExercise.id}`, payload: { target_weight: 55 } });
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.workoutTemplateExercises[0].target_weight).toBe(55);
    expect(state.workoutSets.find((item: any) => item.id === set.id).weight).toBe(52.5);
    expect(state.bodyMetrics[0]).toMatchObject({ weight: 72.4, waist: 81.2 });
    expect(state.workoutTemplates[0].body_part).toBe("胸部与背部");
    expect(state.workouts[0].body_part).toBe("胸部与背部");
  });

  it("stores planned meals separately from actual intake and preserves unknown nutrition", async () => {
    await create("nutritionTargets", { effective_date: "2026-08-01", calories: 2150, protein: 132, carbs: 240, fat: 65 });
    const rice = await create("foods", { name: "米饭", default_portion: 150, portion_unit: "克", calories: 174, protein: 3.9, carbs: 38.4 });
    const planned = await create("meals", { meal_date: "2026-08-02", meal_type: "lunch", name: "鸡胸肉饭", entry_kind: "planned" });
    const actual = await create("meals", { meal_date: "2026-08-02", meal_type: "lunch", name: "实际午餐", entry_kind: "actual" });
    await create("mealItems", { meal_id: planned.id, food_id: rice.id, food_name: "米饭", quantity: 1, calories: 174, protein: 3.9, carbs: 38.4 });
    await create("mealItems", { meal_id: actual.id, food_name: "餐厅时蔬", quantity: 1, calories: null, protein: null });
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.meals.map((item: any) => item.entry_kind).sort()).toEqual(["actual", "planned"]);
    expect(state.mealItems.find((item: any) => item.food_name === "餐厅时蔬")).toMatchObject({ calories: null, protein: null });
    expect(state.nutritionTargets[0].protein).toBe(132);
  });

  it("tracks entertainment status and play sessions without overdue attention", async () => {
    const game = await create("entertainmentItems", { name: "星海旅人", platform: "Steam", activity_type: "game", status: "wishlist", next_goal: "完成序章" });
    await app.inject({ method: "PATCH", url: `/api/collections/entertainmentItems/${game.id}`, payload: { status: "playing", progress: "第一章", rating: 8.5 } });
    await create("playSessions", { entertainment_id: game.id, started_at: "2026-08-02T19:00:00.000Z", ended_at: "2026-08-02T20:37:00.000Z", duration_minutes: 97, progress_note: "到达新城市" });
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.entertainmentItems[0]).toMatchObject({ status: "playing", progress: "第一章", rating: 8.5 });
    expect(state.playSessions[0]).toMatchObject({ duration_minutes: 97, progress_note: "到达新城市" });
    const dashboard = (await app.inject({ method: "GET", url: "/api/dashboard?date=2026-08-03" })).json().data;
    expect(dashboard.attention.some((item: any) => item.module === "entertainment")).toBe(false);
  });

  it("tracks books, reading progress and multiple page-linked notes", async () => {
    const book = await create("books", { title: "思考，快与慢", author: "丹尼尔·卡尼曼", status: "reading", total_pages: 500, current_page: 0 });
    const progress = await app.inject({ method: "POST", url: `/api/books/${book.id}/progress`, payload: { session_date: "2026-08-12", start_page: 1, end_page: 30, duration_minutes: 45, notes: "第一部分" } });
    expect(progress.statusCode).toBe(201);
    expect(progress.json().data.book.current_page).toBe(30);
    expect(progress.json().data.stats).toMatchObject({ pagesRead: 30, minutesRead: 45, completion: 6 });
    await create("readingNotes", { book_id: book.id, note_date: "2026-08-12", chapter: "系统一", start_page: 12, end_page: 12, excerpt: "直觉快速运作", feeling: "很有共鸣", thinking: "哪些决策依赖直觉？" });
    await create("readingNotes", { book_id: book.id, note_date: "2026-08-13", chapter: "系统二", start_page: 31, end_page: 35, feeling: "需要慢下来", thinking: "建立检查清单" });
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.readingNotes.filter((item: any) => item.book_id === book.id)).toHaveLength(2);

    const invalid = await app.inject({ method: "POST", url: `/api/books/${book.id}/progress`, payload: { session_date: "2026-08-14", start_page: 31, end_page: 501, duration_minutes: 10 } });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toContain("当前页不能超过总页数");

    await app.inject({ method: "DELETE", url: `/api/collections/books/${book.id}` });
    const hidden = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(hidden.books).toHaveLength(0);
    expect(hidden.readingSessions).toHaveLength(0);
    expect(hidden.readingNotes).toHaveLength(0);
    await app.inject({ method: "POST", url: `/api/collections/books/${book.id}/restore` });
    const restored = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(restored.readingSessions).toHaveLength(1);
    expect(restored.readingNotes).toHaveLength(2);
  });

  it("keeps one daily reflection and adds each tomorrow action to the plan once", async () => {
    const first = await app.inject({ method: "PUT", url: "/api/reflections/daily", payload: {
      reflection_date: "2026-08-13", source_category: "work", source_detail: "项目交付",
      work_summary: "完成阅读模块", life_summary: "晚饭后散步", gains: "先写测试更稳",
      problems: "低估了文件上传", improvements: "提前列边界",
      actions: [{ content: "整理发布说明" }, { content: "散步三十分钟" }],
    } });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.actions).toHaveLength(2);
    const reflectionId = first.json().data.reflection.id;

    const updated = await app.inject({ method: "PUT", url: "/api/reflections/daily", payload: {
      reflection_date: "2026-08-13", source_category: "life", life_summary: "补充生活总结",
      actions: [{ id: first.json().data.actions[0].id, content: "整理发布说明" }],
    } });
    expect(updated.json().data.reflection.id).toBe(reflectionId);
    expect(updated.json().data.actions).toHaveLength(1);

    const actionId = updated.json().data.actions[0].id;
    const plan1 = await app.inject({ method: "POST", url: `/api/reflection-actions/${actionId}/add-to-plan` });
    const plan2 = await app.inject({ method: "POST", url: `/api/reflection-actions/${actionId}/add-to-plan` });
    expect(plan1.json().data.id).toBe(plan2.json().data.id);
    expect(plan1.json().data).toMatchObject({ plan_date: "2026-08-14", source_module: "reflection", source_entity_type: "reflection_action" });

    await create("thoughtNotes", { note_date: "2026-08-13", title: "一个新发现", source_category: "conversation", source_detail: "和朋友聊天", content: "问题问得越具体，复盘越有价值。" });
    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.dailyReflections).toHaveLength(1);
    expect(state.thoughtNotes).toHaveLength(1);
  });
});
