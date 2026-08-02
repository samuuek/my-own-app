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
});
