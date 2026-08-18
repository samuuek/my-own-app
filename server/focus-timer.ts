import { ValidationError } from "./errors.js";
import { AppStore, type Entity } from "./store.js";

export type FocusTimerStatus = "running" | "paused" | "completed" | "cancelled";

export type FocusTimerSnapshot = Entity & {
  remainingSeconds: number;
  actualSeconds: number | null;
  snapshotAt: string;
};

export class FocusTimerService {
  constructor(private readonly store: AppStore) {}

  current(now = new Date()): FocusTimerSnapshot | null {
    const row = this.store.list("focusTimers").find((item) => ["running", "paused"].includes(item.status));
    return row ? this.snapshot(row, now) : null;
  }

  start(input: { planItemId: string | null; plannedMinutes: number }, now = new Date()): FocusTimerSnapshot {
    if (this.current(now)) throw new ValidationError("已有正在进行的专注计时");
    if (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes < 1 || input.plannedMinutes > 480) {
      throw new ValidationError("专注时长必须是 1 到 480 分钟");
    }
    if (input.planItemId) this.store.get("planItems", input.planItemId);
    const row = this.store.create("focusTimers", {
      plan_item_id: input.planItemId,
      planned_minutes: input.plannedMinutes,
      started_at: now.toISOString(),
      paused_seconds: 0,
      status: "running",
    });
    return this.snapshot(row, now);
  }

  pause(id: string, now = new Date()): FocusTimerSnapshot {
    const row = this.store.get("focusTimers", id);
    if (row.status !== "running") throw new ValidationError("只有进行中的计时可以暂停");
    return this.snapshot(this.store.update("focusTimers", id, {
      status: "paused",
      paused_at: now.toISOString(),
    }), now);
  }

  resume(id: string, now = new Date()): FocusTimerSnapshot {
    const row = this.store.get("focusTimers", id);
    if (row.status !== "paused" || !row.paused_at) throw new ValidationError("只有暂停的计时可以继续");
    const extraPaused = Math.max(0, Math.floor((now.getTime() - Date.parse(row.paused_at)) / 1000));
    return this.snapshot(this.store.update("focusTimers", id, {
      status: "running",
      paused_at: null,
      paused_seconds: Number(row.paused_seconds || 0) + extraPaused,
    }), now);
  }

  finish(id: string, status: "completed" | "cancelled", now = new Date()): FocusTimerSnapshot {
    const row = this.store.get("focusTimers", id);
    if (!["running", "paused"].includes(row.status)) throw new ValidationError("这个计时已经结束");
    const currentPause = row.status === "paused" && row.paused_at
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(row.paused_at)) / 1000))
      : 0;
    const pausedSeconds = Number(row.paused_seconds || 0) + currentPause;
    const actualSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(row.started_at)) / 1000) - pausedSeconds);
    return this.snapshot(this.store.update("focusTimers", id, {
      status,
      paused_at: null,
      paused_seconds: pausedSeconds,
      ended_at: now.toISOString(),
      actual_seconds: actualSeconds,
    }), now);
  }

  private snapshot(row: Entity, now: Date): FocusTimerSnapshot {
    const activeUntil = row.status === "paused" && row.paused_at
      ? Date.parse(row.paused_at)
      : row.ended_at ? Date.parse(row.ended_at) : now.getTime();
    const elapsed = Math.max(0,
      Math.floor((activeUntil - Date.parse(row.started_at)) / 1000) - Number(row.paused_seconds || 0));
    return {
      ...row,
      remainingSeconds: Math.max(0, Number(row.planned_minutes) * 60 - elapsed),
      actualSeconds: row.actual_seconds == null ? null : Number(row.actual_seconds),
      snapshotAt: now.toISOString(),
    } as FocusTimerSnapshot;
  }
}
