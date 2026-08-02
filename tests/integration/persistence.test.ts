// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/app.js";
import { getAppPaths } from "../../server/config.js";
import { DatabaseManager } from "../../server/database.js";
import { AppStore } from "../../server/store.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
afterEach(() => { if (directory) removeTestDirectory(directory); directory = ""; });

describe("SQLite persistence and migrations", () => {
  it("persists a plan item across a complete server restart", async () => {
    directory = makeTestDirectory("persistence");
    const first = await buildApp({ dataDir: directory, autoBackup: false });
    const created = await first.inject({ method: "POST", url: "/api/collections/planItems", payload: { title: "重启后仍然存在", plan_date: "2026-08-02", priority: "high" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;
    await first.close();

    const second = await buildApp({ dataDir: directory, autoBackup: false });
    try {
      const state = await second.inject({ method: "GET", url: "/api/state" });
      expect(state.json().data.planItems).toEqual(expect.arrayContaining([expect.objectContaining({ id, title: "重启后仍然存在" })]));
      expect(fs.existsSync(getAppPaths(directory).dataFile)).toBe(true);
    } finally {
      await second.close();
    }
  });

  it("creates the complete first schema and uses the date/status index", () => {
    directory = makeTestDirectory("schema");
    const manager = new DatabaseManager(getAppPaths(directory));
    try {
      const tables = manager.db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all() as Array<{ name: string }>;
      const names = tables.map((row) => row.name);
      expect(names).toEqual(expect.arrayContaining(["plan_items", "media_contents", "dev_projects", "consulting_projects", "workouts", "meals", "entertainment_items", "trash_entries"]));
      const plan = manager.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM plan_items WHERE plan_date = ? AND status = ? AND deleted_at IS NULL").all("2026-08-02", "todo") as Array<{ detail: string }>;
      expect(plan.some((row) => row.detail.includes("idx_plan_items_date_status"))).toBe(true);
    } finally {
      manager.close();
    }
  });

  it("surfaces a real SQLite write failure instead of pretending to save", () => {
    directory = makeTestDirectory("readonly");
    const manager = new DatabaseManager(getAppPaths(directory));
    const store = new AppStore(manager);
    try {
      manager.db.pragma("query_only = ON");
      expect(() => store.create("planItems", { title: "不能写入", plan_date: "2026-08-02" })).toThrow(/readonly|read-only/i);
      expect(store.list("planItems")).toHaveLength(0);
    } finally {
      manager.db.pragma("query_only = OFF");
      manager.close();
    }
  });
});
