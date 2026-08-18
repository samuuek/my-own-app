// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
let app: FastifyInstance;

beforeEach(async () => {
  directory = makeTestDirectory("progress-workbench");
  app = await buildApp({ dataDir: directory, autoBackup: false });
});

afterEach(async () => {
  await app.close();
  removeTestDirectory(directory);
});

async function create(collection: string, payload: Record<string, unknown>) {
  const response = await app.inject({ method: "POST", url: `/api/collections/${collection}`, payload });
  expect(response.statusCode).toBe(201);
  return response.json().data;
}

describe("progress workbench persistence", () => {
  it("persists dates and goals without disturbing existing plan items", async () => {
    await create("planItems", { title: "保留的任务", plan_date: "2026-08-15" });
    const date = await create("importantDates", {
      name: "纪念日", target_date: "2026-10-01", recurrence: "yearly", color: "blue", sort_order: 0,
    });
    const goal = await create("longTermGoals", {
      name: "完成作品", target_date: "2026-12-31", progress: 35, status: "active", notes: "每周推进", sort_order: 0,
    });

    const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
    expect(state.planItems[0]).toMatchObject({ title: "保留的任务", sort_order: 0 });
    expect(state.importantDates[0]).toMatchObject({ id: date.id, recurrence: "yearly" });
    expect(state.longTermGoals[0]).toMatchObject({ id: goal.id, progress: 35 });
    expect(state.focusTimers).toEqual([]);
  });

  it.each([
    ["importantDates", { name: "无效日期", target_date: "2026-02-30", recurrence: "none" }],
    ["longTermGoals", { name: "越界目标", target_date: "2026-12-31", progress: 101, status: "active" }],
  ])("rejects invalid %s input", async (collection, payload) => {
    const response = await app.inject({ method: "POST", url: `/api/collections/${collection}`, payload });
    expect(response.statusCode).toBe(400);
  });

  it("assigns stable increasing order to newly created tasks", async () => {
    const first = await create("planItems", { title: "第一项", plan_date: "2026-08-15" });
    const second = await create("planItems", { title: "第二项", plan_date: "2026-08-15" });
    expect(first.sort_order).toBe(0);
    expect(second.sort_order).toBe(1);
  });
});
