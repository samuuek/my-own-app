// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "../../server/database.js";
import { FocusTimerService } from "../../server/focus-timer.js";
import { getAppPaths } from "../../server/config.js";
import { AppStore } from "../../server/store.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
let manager: DatabaseManager;
let service: FocusTimerService;

beforeEach(() => {
  directory = makeTestDirectory("focus-timer");
  manager = new DatabaseManager(getAppPaths(directory));
  service = new FocusTimerService(new AppStore(manager));
});

afterEach(() => {
  manager.close();
  removeTestDirectory(directory);
});

describe("focus timer state machine", () => {
  it("pauses, resumes and finishes using server time", () => {
    const timer = service.start({ planItemId: null, plannedMinutes: 25 }, new Date("2026-08-15T01:00:00.000Z"));
    expect(timer).toMatchObject({ status: "running", remainingSeconds: 1500 });
    expect(() => service.start({ planItemId: null, plannedMinutes: 10 }, new Date("2026-08-15T01:02:00.000Z"))).toThrow("已有正在进行的专注计时");

    const paused = service.pause(timer.id, new Date("2026-08-15T01:05:00.000Z"));
    expect(paused).toMatchObject({ status: "paused", remainingSeconds: 1200 });
    const stillPaused = service.current(new Date("2026-08-15T01:15:00.000Z"));
    expect(stillPaused).toMatchObject({ status: "paused", remainingSeconds: 1200 });

    const resumed = service.resume(timer.id, new Date("2026-08-15T01:15:00.000Z"));
    expect(resumed).toMatchObject({ status: "running", remainingSeconds: 1200 });
    const finished = service.finish(timer.id, "completed", new Date("2026-08-15T01:20:00.000Z"));
    expect(finished).toMatchObject({ status: "completed", actualSeconds: 600, remainingSeconds: 900 });
    expect(service.current(new Date("2026-08-15T01:20:01.000Z"))).toBeNull();
  });

  it("rejects invalid durations and missing linked tasks", () => {
    expect(() => service.start({ planItemId: null, plannedMinutes: 0 })).toThrow("专注时长必须是 1 到 480 分钟");
    expect(() => service.start({ planItemId: "missing", plannedMinutes: 25 })).toThrow("没有找到这条记录");
  });
});
