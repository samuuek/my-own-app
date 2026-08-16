// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CloudFocusTimerService } from "../../server/cloud/focus-timer.js";
import type { CloudStore } from "../../server/cloud/store.js";
import type { CollectionName } from "../../server/collections.js";
import type { Entity } from "../../server/store.js";

class MemoryFocusStore {
  readonly rows: Record<string, Entity[]> = { planItems: [], focusTimers: [] };
  transactions = 0;
  private nextId = 1;

  asCloudStore(): CloudStore {
    return {
      list: async (name: CollectionName) => [...(this.rows[name] ?? [])],
      get: async () => { throw new Error("root get escaped transaction"); },
      create: async () => { throw new Error("root create escaped transaction"); },
      update: async () => { throw new Error("root update escaped transaction"); },
      transaction: async <T>(work: (store: CloudStore) => Promise<T>) => {
        this.transactions += 1;
        return work(this.transactionStore());
      },
    } as unknown as CloudStore;
  }

  private transactionStore(): CloudStore {
    return {
      list: async (name: CollectionName) => [...(this.rows[name] ?? [])],
      get: async (name: CollectionName, id: string) => {
        const row = (this.rows[name] ?? []).find((item) => item.id === id && !item.deleted_at);
        if (!row) throw new Error("没有找到这条记录");
        return { ...row };
      },
      create: async (name: CollectionName, input: Entity) => {
        await Promise.resolve();
        if (name === "focusTimers" && this.rows.focusTimers.some((item) => ["running", "paused"].includes(item.status))) {
          const error = new Error("duplicate active timer") as Error & { code: string; constraint: string };
          error.code = "23505";
          error.constraint = "uq_workspace_active_focus_timer";
          throw error;
        }
        const row = { id: `${name}-${this.nextId++}`, ...input, created_at: "2026-08-15T00:00:00.000Z", updated_at: "2026-08-15T00:00:00.000Z" };
        (this.rows[name] ??= []).push(row);
        return { ...row };
      },
      update: async (name: CollectionName, id: string, input: Entity) => {
        const index = (this.rows[name] ?? []).findIndex((item) => item.id === id);
        if (index < 0) throw new Error("没有找到这条记录");
        this.rows[name][index] = { ...this.rows[name][index], ...input };
        return { ...this.rows[name][index] };
      },
    } as unknown as CloudStore;
  }
}

describe("CloudFocusTimerService", () => {
  it("starts, pauses, resumes and completes a timer with stable remaining time", async () => {
    const memory = new MemoryFocusStore();
    const service = new CloudFocusTimerService(memory.asCloudStore());

    const timer = await service.start({ planItemId: null, plannedMinutes: 25 }, new Date("2026-08-15T01:00:00.000Z"));
    expect(timer).toMatchObject({ status: "running", remainingSeconds: 1500 });
    const paused = await service.pause(timer.id, new Date("2026-08-15T01:05:00.000Z"));
    expect(paused).toMatchObject({ status: "paused", remainingSeconds: 1200 });
    await expect(service.current(new Date("2026-08-15T01:15:00.000Z"))).resolves.toMatchObject({ remainingSeconds: 1200 });
    const resumed = await service.resume(timer.id, new Date("2026-08-15T01:15:00.000Z"));
    expect(resumed).toMatchObject({ status: "running", remainingSeconds: 1200 });
    const finished = await service.finish(timer.id, "completed", new Date("2026-08-15T01:20:00.000Z"));
    expect(finished).toMatchObject({ status: "completed", actualSeconds: 600, remainingSeconds: 900 });
    await expect(service.current(new Date("2026-08-15T01:20:01.000Z"))).resolves.toBeNull();
    expect(memory.transactions).toBe(4);
  });

  it("cancels an active timer and rejects invalid state transitions", async () => {
    const memory = new MemoryFocusStore();
    const service = new CloudFocusTimerService(memory.asCloudStore());
    const timer = await service.start({ planItemId: null, plannedMinutes: 10 }, new Date("2026-08-15T02:00:00.000Z"));

    const cancelled = await service.finish(timer.id, "cancelled", new Date("2026-08-15T02:01:00.000Z"));

    expect(cancelled).toMatchObject({ status: "cancelled", actualSeconds: 60 });
    await expect(service.pause(timer.id, new Date("2026-08-15T02:02:00.000Z"))).rejects.toThrow("只有进行中的计时可以暂停");
    await expect(service.resume(timer.id, new Date("2026-08-15T02:02:00.000Z"))).rejects.toThrow("只有暂停的计时可以继续");
  });

  it("validates duration and linked plan items", async () => {
    const memory = new MemoryFocusStore();
    const service = new CloudFocusTimerService(memory.asCloudStore());

    await expect(service.start({ planItemId: null, plannedMinutes: 0 })).rejects.toThrow("专注时长必须是 1 到 480 分钟");
    await expect(service.start({ planItemId: "missing", plannedMinutes: 25 })).rejects.toThrow("没有找到这条记录");
  });

  it("turns the active-timer unique-index race into a clean validation error", async () => {
    const memory = new MemoryFocusStore();
    const service = new CloudFocusTimerService(memory.asCloudStore());

    const results = await Promise.allSettled([
      service.start({ planItemId: null, plannedMinutes: 25 }, new Date("2026-08-15T03:00:00.000Z")),
      service.start({ planItemId: null, plannedMinutes: 10 }, new Date("2026-08-15T03:00:00.000Z")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ statusCode: 400, message: "已有正在进行的专注计时" });
    expect(memory.rows.focusTimers.filter((item) => ["running", "paused"].includes(item.status))).toHaveLength(1);
  });
});
