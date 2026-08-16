import { ValidationError } from "../errors.js";
import type { FocusTimerSnapshot } from "../focus-timer.js";
import type { Entity } from "../store.js";
import type { CloudStore } from "./store.js";

type PostgresError = Error & { code?: string; constraint?: string; constraint_name?: string };

function isActiveTimerConflict(error: unknown): boolean {
  const postgresError = error as PostgresError;
  return postgresError?.code === "23505"
    && (postgresError.constraint === "uq_workspace_active_focus_timer"
      || postgresError.constraint_name === "uq_workspace_active_focus_timer"
      || postgresError.message.includes("uq_workspace_active_focus_timer"));
}

function snapshot(row: Entity, now: Date): FocusTimerSnapshot {
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

export class CloudFocusTimerService {
  constructor(private readonly store: CloudStore) {}

  async current(now = new Date()): Promise<FocusTimerSnapshot | null> {
    const row = (await this.store.list("focusTimers"))
      .find((item) => ["running", "paused"].includes(item.status));
    return row ? snapshot(row, now) : null;
  }

  async start(
    input: { planItemId: string | null; plannedMinutes: number },
    now = new Date(),
  ): Promise<FocusTimerSnapshot> {
    if (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes < 1 || input.plannedMinutes > 480) {
      throw new ValidationError("专注时长必须是 1 到 480 分钟");
    }
    try {
      return await this.store.transaction(async (store) => {
        const active = (await store.list("focusTimers"))
          .find((item) => ["running", "paused"].includes(item.status));
        if (active) throw new ValidationError("已有正在进行的专注计时");
        if (input.planItemId) await store.get("planItems", input.planItemId);
        const row = await store.create("focusTimers", {
          plan_item_id: input.planItemId,
          planned_minutes: input.plannedMinutes,
          started_at: now.toISOString(),
          paused_seconds: 0,
          status: "running",
        });
        return snapshot(row, now);
      });
    } catch (error) {
      if (isActiveTimerConflict(error)) throw new ValidationError("已有正在进行的专注计时");
      throw error;
    }
  }

  async pause(id: string, now = new Date()): Promise<FocusTimerSnapshot> {
    return this.store.transaction(async (store) => {
      const row = await store.getForUpdate("focusTimers", id);
      if (row.status !== "running") throw new ValidationError("只有进行中的计时可以暂停");
      const updated = await store.update("focusTimers", id, {
        status: "paused",
        paused_at: now.toISOString(),
      });
      return snapshot(updated, now);
    });
  }

  async resume(id: string, now = new Date()): Promise<FocusTimerSnapshot> {
    return this.store.transaction(async (store) => {
      const row = await store.getForUpdate("focusTimers", id);
      if (row.status !== "paused" || !row.paused_at) throw new ValidationError("只有暂停的计时可以继续");
      const extraPaused = Math.max(0, Math.floor((now.getTime() - Date.parse(row.paused_at)) / 1000));
      const updated = await store.update("focusTimers", id, {
        status: "running",
        paused_at: null,
        paused_seconds: Number(row.paused_seconds || 0) + extraPaused,
      });
      return snapshot(updated, now);
    });
  }

  async finish(
    id: string,
    status: "completed" | "cancelled",
    now = new Date(),
  ): Promise<FocusTimerSnapshot> {
    return this.store.transaction(async (store) => {
      const row = await store.getForUpdate("focusTimers", id);
      if (!["running", "paused"].includes(row.status)) throw new ValidationError("这个计时已经结束");
      const currentPause = row.status === "paused" && row.paused_at
        ? Math.max(0, Math.floor((now.getTime() - Date.parse(row.paused_at)) / 1000))
        : 0;
      const pausedSeconds = Number(row.paused_seconds || 0) + currentPause;
      const actualSeconds = Math.max(0,
        Math.floor((now.getTime() - Date.parse(row.started_at)) / 1000) - pausedSeconds);
      const updated = await store.update("focusTimers", id, {
        status,
        paused_at: null,
        paused_seconds: pausedSeconds,
        ended_at: now.toISOString(),
        actual_seconds: actualSeconds,
      });
      return snapshot(updated, now);
    });
  }
}
