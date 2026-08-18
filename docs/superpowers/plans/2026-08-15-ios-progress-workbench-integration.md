# iPhone 系统外观与进度工作台正式整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已验证的 iPhone 系统外观、今日进度、重要日期、长期目标、今日任务、专注计时和首次引导原生接入正式应用，同时保留现有数据和另外三套外观。

**Architecture:** 沿用 React、TanStack Query、Fastify 与 SQLite，在现有集合存储上增加三类持久化数据，并扩展现有 `/api/dashboard` 聚合结果。专注计时的状态迁移由独立领域服务控制；首页拆为独立面板和表单组件；iPhone 外观只通过语义化 CSS 变量与专属选择器覆盖，不污染其他主题。

**Tech Stack:** TypeScript 5.9、React 19、TanStack Query 5、Fastify 5、Zod 4、better-sqlite3 12、Vitest 3、Testing Library、Playwright 1.55、CSS。

## Global Constraints

- 页面浅色背景必须使用 `#F2F2F7`，主卡片使用 `#FFFFFF`。
- 主操作蓝、成功绿、提醒橙、危险红分别使用 `#007AFF`、`#34C759`、`#FF9500`、`#FF3B30`。
- Liquid Glass、Notion、Neo 三套外观必须保留并可随时切换。
- 升级后的第一次正式启动必须切换到 iPhone 系统外观；之后不得覆盖用户的新选择。
- 数据库迁移只能追加表、索引或设置，不得清空或重建现有业务表。
- 今日无任务时进度为 `0`，界面显示“还没有安排任务”，不得显示 100%。
- 任一时刻最多存在一个 `running` 或 `paused` 的专注会话。
- 独立 Demo 只作为参考，不得成为正式应用的运行时依赖。
- 不增加账户、云同步、多人协作或新第三方依赖。

## File Structure

- `database/migrations/005_progress_workbench.sql`：追加重要日期、长期目标、专注计时表和一次性外观迁移。
- `server/errors.ts`：存放服务端通用校验与未找到错误，避免领域模块和存储模块循环引用。
- `server/workbench.ts`：日期、目标输入校验与重复日期计算。
- `server/focus-timer.ts`：专注计时状态机和服务器时间快照。
- `server/collections.ts`、`server/store.ts`：把三类数据接入现有集合、回收站、备份与导出路径。
- `server/dashboard.ts`、`server/app.ts`：扩展首页聚合结果并暴露计时动作接口。
- `src/features/workbench/model.ts`：浏览器端倒计时格式化和快照计算。
- `src/features/workbench/ProgressOverview.tsx`：日期、问候语和今日进度环。
- `src/features/workbench/ImportantDatesPanel.tsx`：日期卡片与操作入口。
- `src/features/workbench/LongTermGoalsPanel.tsx`：目标卡片与操作入口。
- `src/features/workbench/FocusTimerPanel.tsx`：当前计时展示与控制。
- `src/features/workbench/WorkbenchDialogs.tsx`：日期、目标的新增编辑表单和删除确认。
- `src/features/workbench/OnboardingModal.tsx`：三步首次引导。
- `src/themes/ios.css`：iPhone 系统外观、响应式和减少动态效果规则。
- `src/pages/DashboardPage.tsx`：编排新面板并保留现有备忘、提醒和模块摘要。
- `src/pages/SettingsPage.tsx`：第四套外观与重新查看引导入口。

---

### Task 1: 持久化表、集合和输入约束

**Files:**
- Create: `database/migrations/005_progress_workbench.sql`
- Create: `server/errors.ts`
- Create: `server/workbench.ts`
- Modify: `server/collections.ts:1-226`
- Modify: `server/store.ts:24-76`
- Modify: `server/app.ts:1-12`
- Modify: `src/types.ts:1-45`
- Modify: `src/WorkspaceContext.tsx:20-30`
- Test: `tests/integration/progress-workbench-persistence.test.ts`

**Interfaces:**
- Produces: collections `importantDates`, `longTermGoals`, `focusTimers`.
- Produces: `validateWorkbenchEntity(name, current, input): void` and `resolveImportantDate(targetDate, recurrence, today)`.
- Produces: `WorkspaceState.importantDates`, `WorkspaceState.longTermGoals`, `WorkspaceState.focusTimers`.

- [ ] **Step 1: Write the failing persistence and validation tests**

```ts
// tests/integration/progress-workbench-persistence.test.ts
it("persists dates and goals without disturbing existing plan items", async () => {
  await create("planItems", { title: "保留的任务", plan_date: "2026-08-15" });
  const date = await create("importantDates", {
    name: "纪念日", target_date: "2026-10-01", recurrence: "yearly", color: "blue", sort_order: 0,
  });
  const goal = await create("longTermGoals", {
    name: "完成作品", target_date: "2026-12-31", progress: 35, status: "active", notes: "每周推进", sort_order: 0,
  });
  const state = (await app.inject({ method: "GET", url: "/api/state" })).json().data;
  expect(state.planItems[0].title).toBe("保留的任务");
  expect(state.importantDates[0]).toMatchObject({ id: date.id, recurrence: "yearly" });
  expect(state.longTermGoals[0]).toMatchObject({ id: goal.id, progress: 35 });
});

it.each([
  ["importantDates", { name: "无效日期", target_date: "2026-02-30", recurrence: "none" }],
  ["longTermGoals", { name: "越界目标", target_date: "2026-12-31", progress: 101, status: "active" }],
])("rejects invalid %s input", async (collection, payload) => {
  const response = await app.inject({ method: "POST", url: `/api/collections/${collection}`, payload });
  expect(response.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run the new test and confirm the missing collections fail**

Run: `npm test -- tests/integration/progress-workbench-persistence.test.ts`

Expected: FAIL because `importantDates` and `longTermGoals` are not recognized.

- [ ] **Step 3: Add the append-only migration**

```sql
-- database/migrations/005_progress_workbench.sql
ALTER TABLE plan_items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY plan_date ORDER BY COALESCE(start_time, '99:99'), created_at) - 1 AS position
  FROM plan_items
)
UPDATE plan_items SET sort_order = (SELECT position FROM ranked WHERE ranked.id = plan_items.id);

CREATE TABLE IF NOT EXISTS important_dates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'yearly')),
  color TEXT NOT NULL DEFAULT 'blue' CHECK (color IN ('blue', 'green', 'orange', 'red')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS long_term_goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_date TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS focus_timers (
  id TEXT PRIMARY KEY,
  plan_item_id TEXT REFERENCES plan_items(id) ON DELETE SET NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes > 0),
  started_at TEXT NOT NULL,
  paused_at TEXT,
  paused_seconds INTEGER NOT NULL DEFAULT 0 CHECK (paused_seconds >= 0),
  ended_at TEXT,
  actual_seconds INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_important_dates_sort ON important_dates(sort_order, target_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_long_term_goals_status_sort ON long_term_goals(status, sort_order) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_plan_items_date_sort ON plan_items(plan_date, sort_order, start_time) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_timers_one_active ON focus_timers((1))
  WHERE deleted_at IS NULL AND status IN ('running', 'paused');

INSERT INTO settings(key, value, updated_at) VALUES
  ('appearance', '"ios"', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
INSERT INTO settings(key, value, updated_at) VALUES
  ('ios_progress_workbench_migrated_v1', 'true', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
ON CONFLICT(key) DO NOTHING;
```

- [ ] **Step 4: Add collection definitions and frontend state keys**

```ts
// server/collections.ts
importantDates: {
  table: "important_dates", title: "name", module: "dashboard",
  required: ["name", "target_date"],
  fields: ["name", "target_date", "recurrence", "color", "sort_order"],
  search: ["name"],
},
longTermGoals: {
  table: "long_term_goals", title: "name", module: "dashboard",
  required: ["name"],
  fields: ["name", "target_date", "progress", "notes", "status", "sort_order"],
  search: ["name", "notes"],
},
focusTimers: {
  table: "focus_timers", title: "started_at", module: "dashboard",
  required: ["planned_minutes", "started_at", "status"],
  fields: ["plan_item_id", "planned_minutes", "started_at", "paused_at", "paused_seconds", "ended_at", "actual_seconds", "status"],
  search: [],
},
```

Add the same three array properties to `WorkspaceState` and `emptyState` so `/api/state`, backup export, search routing, trash restore, and client rendering share one collection list. Also append `sort_order` to the existing `planItems.fields` list in `server/collections.ts`; do not change any existing required task field.

- [ ] **Step 5: Implement strict date and goal validation**

```ts
// server/errors.ts
export class ValidationError extends Error { statusCode = 400; }
export class NotFoundError extends Error { statusCode = 404; }

// server/workbench.ts
import { ValidationError } from "./errors.js";
import type { Entity } from "./store.js";

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function validateWorkbenchEntity(name: string, current: Entity | null, input: Entity): void {
  const merged = { ...(current ?? {}), ...input };
  if (name === "importantDates") {
    if (!String(merged.name ?? "").trim()) throw new ValidationError("请填写日期名称");
    if (!isIsoDate(merged.target_date)) throw new ValidationError("请选择有效日期");
    if (!["none", "yearly"].includes(merged.recurrence ?? "none")) throw new ValidationError("重复方式无效");
  }
  if (name === "longTermGoals") {
    if (!String(merged.name ?? "").trim()) throw new ValidationError("请填写目标名称");
    if (merged.target_date && !isIsoDate(merged.target_date)) throw new ValidationError("请选择有效目标日期");
    const progress = Number(merged.progress ?? 0);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new ValidationError("目标进度必须是 0 到 100 的整数");
    if (!["active", "completed"].includes(merged.status ?? "active")) throw new ValidationError("目标状态无效");
  }
}
```

Call it in `AppStore.create()` with `null` and in `AppStore.update()` with `this.get(name, id, true)` before writing SQL.
Move the two existing error class definitions out of `server/store.ts`; import them from `server/errors.ts` in both `server/store.ts` and `server/app.ts`. This keeps `store.ts → workbench.ts → errors.ts` acyclic.

Assign a stable order to every newly created task before insertion:

```ts
if (name === "planItems" && clean.sort_order === undefined) {
  const row = this.manager.db.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM plan_items WHERE plan_date = ? AND deleted_at IS NULL").get(clean.plan_date) as { next: number };
  clean.sort_order = row.next;
}
```

- [ ] **Step 6: Run persistence tests and the existing integration suite**

Run: `npm test -- tests/integration/progress-workbench-persistence.test.ts tests/integration/persistence.test.ts tests/integration/backup-export.test.ts`

Expected: PASS; the exported state includes the new collections and existing records remain intact.

- [ ] **Step 7: Commit the persistence foundation**

```bash
git add database/migrations/005_progress_workbench.sql server/errors.ts server/workbench.ts server/collections.ts server/store.ts server/app.ts src/types.ts src/WorkspaceContext.tsx tests/integration/progress-workbench-persistence.test.ts
git commit -m "feat: add progress workbench persistence"
```

### Task 2: 日期计算与首页聚合数据

**Files:**
- Modify: `server/workbench.ts`
- Modify: `server/dashboard.ts:1-75`
- Modify: `src/types.ts:39-45`
- Test: `tests/unit/workbench.test.ts`
- Modify Test: `tests/integration/planning-dashboard.test.ts:25-60`

**Interfaces:**
- Consumes: `importantDates`, `longTermGoals` collections from Task 1.
- Produces: `resolveImportantDate(targetDate, recurrence, today): { displayDate: string; daysRemaining: number; state: "future" | "today" | "overdue" }`.
- Produces: `DashboardData.importantDates`, `DashboardData.longTermGoals`, `DashboardData.sectionErrors`.

- [ ] **Step 1: Write leap-year, recurrence, empty-progress, and section-isolation tests**

```ts
// tests/unit/workbench.test.ts
expect(resolveImportantDate("2024-02-29", "yearly", "2026-03-01")).toEqual({
  displayDate: "2027-02-28", daysRemaining: 364, state: "future",
});
expect(resolveImportantDate("2026-08-15", "none", "2026-08-15").state).toBe("today");
expect(resolveImportantDate("2026-08-14", "none", "2026-08-15").state).toBe("overdue");
```

Extend `planning-dashboard.test.ts` to create one date and one goal, then assert the dashboard response contains resolved days, sorted goals, `activeFocusTimer: null`, and `sectionErrors: {}`.

- [ ] **Step 2: Run the focused tests and confirm the fields are missing**

Run: `npm test -- tests/unit/workbench.test.ts tests/integration/planning-dashboard.test.ts`

Expected: FAIL because `resolveImportantDate` and the new dashboard fields do not exist.

- [ ] **Step 3: Implement calendar-safe recurrence calculation**

```ts
// server/workbench.ts
export function resolveImportantDate(targetDate: string, recurrence: "none" | "yearly", today: string) {
  let displayDate = targetDate;
  if (recurrence === "yearly" && targetDate < today) {
    const [, month, day] = targetDate.split("-").map(Number);
    let year = Number(today.slice(0, 4));
    const anniversary = (candidateYear: number) => {
      if (month === 2 && day === 29 && !isIsoDate(`${candidateYear}-02-29`)) return `${candidateYear}-02-28`;
      return `${candidateYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    };
    displayDate = anniversary(year);
    if (displayDate < today) displayDate = anniversary(++year);
  }
  const daysRemaining = Math.round((Date.parse(`${displayDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  return { displayDate, daysRemaining, state: daysRemaining > 0 ? "future" : daysRemaining === 0 ? "today" : "overdue" } as const;
}
```

- [ ] **Step 4: Extend `buildDashboard` with isolated sections**

```ts
// server/dashboard.ts
const sectionErrors: Record<string, string> = {};
const safeSection = <T,>(key: string, fallback: T, read: () => T): T => {
  try { return read(); }
  catch (error) { sectionErrors[key] = error instanceof Error ? error.message : "数据不可用"; return fallback; }
};

const orderedTodayItems = todayItems.sort((a, b) =>
  Number(a.sort_order || 0) - Number(b.sort_order || 0)
  || String(a.start_time || "").localeCompare(String(b.start_time || "")),
);
const importantDates = safeSection("importantDates", [], () => store.list("importantDates")
  .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
  .map((item) => ({ ...item, ...resolveImportantDate(item.target_date, item.recurrence ?? "none", date) })));
const longTermGoals = safeSection("longTermGoals", [], () => store.list("longTermGoals")
  .sort((a, b) => Number(a.sort_order) - Number(b.sort_order)));
```

Build `timeline` and `unscheduled` from `orderedTodayItems`. Return both arrays, `activeFocusTimer: null`, and `sectionErrors`. Extend `DashboardData` with exact matching property names.

- [ ] **Step 5: Run dashboard and existing work-module tests**

Run: `npm test -- tests/unit/workbench.test.ts tests/integration/planning-dashboard.test.ts tests/integration/work-modules.test.ts`

Expected: PASS, including all existing timeline, attention, and summary assertions.

- [ ] **Step 6: Commit the dashboard data extension**

```bash
git add server/workbench.ts server/dashboard.ts src/types.ts tests/unit/workbench.test.ts tests/integration/planning-dashboard.test.ts
git commit -m "feat: add goals and dates to dashboard data"
```

### Task 3: 可恢复的专注计时状态机与接口

**Files:**
- Create: `server/focus-timer.ts`
- Modify: `server/app.ts:60-90`
- Modify: `server/dashboard.ts`
- Modify: `src/api.ts:20-35`
- Modify: `src/types.ts`
- Test: `tests/unit/focus-timer.test.ts`
- Modify Test: `tests/integration/planning-dashboard.test.ts`

**Interfaces:**
- Consumes: `AppStore` and `focusTimers` collection from Task 1.
- Produces: `FocusTimerSnapshot` with `remainingSeconds` and `snapshotAt`.
- Produces API calls `startFocusTimer`, `pauseFocusTimer`, `resumeFocusTimer`, `finishFocusTimer`.

- [ ] **Step 1: Write deterministic state-transition tests**

```ts
// tests/unit/focus-timer.test.ts
const timer = service.start({ planItemId: null, plannedMinutes: 25 }, new Date("2026-08-15T01:00:00.000Z"));
expect(timer).toMatchObject({ status: "running", remainingSeconds: 1500 });
expect(() => service.start({ planItemId: null, plannedMinutes: 10 }, new Date("2026-08-15T01:02:00.000Z"))).toThrow("已有正在进行的专注计时");
const paused = service.pause(timer.id, new Date("2026-08-15T01:05:00.000Z"));
expect(paused).toMatchObject({ status: "paused", remainingSeconds: 1200 });
const resumed = service.resume(timer.id, new Date("2026-08-15T01:15:00.000Z"));
expect(resumed.status).toBe("running");
const finished = service.finish(timer.id, "completed", new Date("2026-08-15T01:20:00.000Z"));
expect(finished).toMatchObject({ status: "completed", actualSeconds: 600 });
```

- [ ] **Step 2: Run the unit test and confirm the service is missing**

Run: `npm test -- tests/unit/focus-timer.test.ts`

Expected: FAIL because `FocusTimerService` does not exist.

- [ ] **Step 3: Implement the state machine with server-time snapshots**

```ts
// server/focus-timer.ts
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
  start(input: { planItemId: string | null; plannedMinutes: number }, now = new Date()) {
    if (this.current(now)) throw new ValidationError("已有正在进行的专注计时");
    if (!Number.isInteger(input.plannedMinutes) || input.plannedMinutes <= 0 || input.plannedMinutes > 480) throw new ValidationError("专注时长必须是 1 到 480 分钟");
    if (input.planItemId) this.store.get("planItems", input.planItemId);
    return this.snapshot(this.store.create("focusTimers", {
      plan_item_id: input.planItemId, planned_minutes: input.plannedMinutes,
      started_at: now.toISOString(), paused_seconds: 0, status: "running",
    }), now);
  }
  pause(id: string, now = new Date()) {
    const row = this.store.get("focusTimers", id);
    if (row.status !== "running") throw new ValidationError("只有进行中的计时可以暂停");
    return this.snapshot(this.store.update("focusTimers", id, {
      status: "paused", paused_at: now.toISOString(),
    }), now);
  }
  resume(id: string, now = new Date()) {
    const row = this.store.get("focusTimers", id);
    if (row.status !== "paused" || !row.paused_at) throw new ValidationError("只有暂停的计时可以继续");
    const extraPaused = Math.max(0, Math.floor((now.getTime() - Date.parse(row.paused_at)) / 1000));
    return this.snapshot(this.store.update("focusTimers", id, {
      status: "running", paused_at: null,
      paused_seconds: Number(row.paused_seconds || 0) + extraPaused,
    }), now);
  }
  finish(id: string, status: "completed" | "cancelled", now = new Date()) {
    const row = this.store.get("focusTimers", id);
    if (!["running", "paused"].includes(row.status)) throw new ValidationError("这个计时已经结束");
    const activeUntil = row.status === "paused" && row.paused_at ? Date.parse(row.paused_at) : now.getTime();
    const actualSeconds = Math.max(0, Math.floor((activeUntil - Date.parse(row.started_at)) / 1000) - Number(row.paused_seconds || 0));
    return this.snapshot(this.store.update("focusTimers", id, {
      status, paused_at: null, ended_at: now.toISOString(), actual_seconds: actualSeconds,
    }), now);
  }
  private snapshot(row: Entity, now: Date): FocusTimerSnapshot {
    const activeUntil = row.status === "paused" && row.paused_at
      ? Date.parse(row.paused_at)
      : row.ended_at ? Date.parse(row.ended_at) : now.getTime();
    const elapsed = Math.max(0, Math.floor((activeUntil - Date.parse(row.started_at)) / 1000) - Number(row.paused_seconds || 0));
    const actualSeconds = row.actual_seconds == null ? null : Number(row.actual_seconds);
    return {
      ...row,
      remainingSeconds: Math.max(0, Number(row.planned_minutes) * 60 - elapsed),
      actualSeconds,
      snapshotAt: now.toISOString(),
    } as FocusTimerSnapshot;
  }
}
```

- [ ] **Step 4: Expose exact timer routes and client methods**

```ts
// server/app.ts
const focusTimers = new FocusTimerService(store);
app.get("/api/focus-timers/current", async () => ({ data: focusTimers.current() }));
app.post("/api/focus-timers", async (request, reply) => {
  const body = z.object({ planItemId: z.string().nullable().default(null), plannedMinutes: z.number().int().min(1).max(480) }).parse(request.body ?? {});
  return reply.code(201).send({ data: focusTimers.start(body) });
});
app.post("/api/focus-timers/:id/pause", async (request) => ({ data: focusTimers.pause((request.params as { id: string }).id) }));
app.post("/api/focus-timers/:id/resume", async (request) => ({ data: focusTimers.resume((request.params as { id: string }).id) }));
app.post("/api/focus-timers/:id/finish", async (request) => {
  const body = z.object({ status: z.enum(["completed", "cancelled"]).default("completed") }).parse(request.body ?? {});
  return { data: focusTimers.finish((request.params as { id: string }).id, body.status) };
});
```

Add matching typed methods in `src/api.ts`, using `FocusTimerSnapshot` from `src/types.ts`.

```ts
// src/types.ts
export type FocusTimerSnapshot = Entity & {
  status: "running" | "paused" | "completed" | "cancelled";
  remainingSeconds: number;
  actualSeconds: number | null;
  snapshotAt: string;
};

// src/api.ts
startFocusTimer: (input: { planItemId: string | null; plannedMinutes: number }) =>
  request<FocusTimerSnapshot>("/api/focus-timers", { method: "POST", body: JSON.stringify(input) }),
pauseFocusTimer: (id: string) => request<FocusTimerSnapshot>(`/api/focus-timers/${id}/pause`, { method: "POST" }),
resumeFocusTimer: (id: string) => request<FocusTimerSnapshot>(`/api/focus-timers/${id}/resume`, { method: "POST" }),
finishFocusTimer: (id: string, status: "completed" | "cancelled" = "completed") =>
  request<FocusTimerSnapshot>(`/api/focus-timers/${id}/finish`, { method: "POST", body: JSON.stringify({ status }) }),
```

- [ ] **Step 5: Add the active snapshot to dashboard aggregation**

Pass `focusTimers.current()` into `buildDashboard` and return it as `activeFocusTimer`. If the timer read fails, set `sectionErrors.focusTimer` and return `null` without affecting other sections.

- [ ] **Step 6: Run timer, dashboard, and persistence tests**

Run: `npm test -- tests/unit/focus-timer.test.ts tests/integration/planning-dashboard.test.ts tests/integration/progress-workbench-persistence.test.ts`

Expected: PASS; a second active timer returns HTTP 400 and a refreshed dashboard returns the active snapshot.

- [ ] **Step 7: Commit the timer domain**

```bash
git add server/focus-timer.ts server/app.ts server/dashboard.ts src/api.ts src/types.ts tests/unit/focus-timer.test.ts tests/integration/planning-dashboard.test.ts
git commit -m "feat: add recoverable focus timer"
```

### Task 4: 第四套 iPhone 系统外观与一次性默认迁移

**Files:**
- Modify: `src/appearance.ts:1-7`
- Modify: `src/main.tsx:1-12`
- Modify: `src/components/Layout.tsx:68-150`
- Modify: `src/pages/SettingsPage.tsx:1-60`
- Create: `src/themes/ios.css`
- Modify Test: `tests/unit/appearance.test.ts`
- Modify Test: `tests/components/app-shell.test.tsx`

**Interfaces:**
- Consumes: migration setting `appearance: "ios"` from Task 1.
- Produces: `Appearance = "ios" | "liquid" | "notebook" | "neo"`.
- Produces: root attributes `data-appearance="ios"` and `.ios-shell`.

- [ ] **Step 1: Change tests to expect iPhone as the safe default and fourth persisted value**

```ts
expect(normalizeAppearance(undefined)).toBe("ios");
expect(normalizeAppearance("legacy-paper")).toBe("ios");
expect(normalizeAppearance("ios")).toBe("ios");
expect(normalizeAppearance("liquid")).toBe("liquid");
expect(normalizeAppearance("notebook")).toBe("notebook");
expect(normalizeAppearance("neo")).toBe("neo");
```

In `app-shell.test.tsx`, assert iPhone mounts `.ios-shell`, does not mount `.ambient-environment` or `.notebook-environment`, and keeps the unified brand icon.

- [ ] **Step 2: Run appearance and shell tests and confirm failure**

Run: `npm test -- tests/unit/appearance.test.ts tests/components/app-shell.test.tsx`

Expected: FAIL because `ios` is normalized to `liquid` and there is no iPhone selector.

- [ ] **Step 3: Extend appearance normalization and shell classes**

```ts
// src/appearance.ts
export type Appearance = "ios" | "liquid" | "notebook" | "neo";
export function normalizeAppearance(value: unknown): Appearance {
  return value === "liquid" || value === "notebook" || value === "neo" || value === "ios" ? value : "ios";
}
```

Add `appearance === "ios" && "ios-shell"` to `AppLayout`; preserve the existing Liquid ambient, Notebook environment, and Neo emblem conditions exactly.
Map `importantDates`, `longTermGoals`, and `focusTimers` to `/` in `collectionRoutes`, and add the three names to the mocked collection array in `tests/components/app-shell.test.tsx`.

- [ ] **Step 4: Add the fourth selector and onboarding reset action to settings**

```tsx
<button className={appearance === "ios" ? "active" : ""} aria-label="iPhone 系统" aria-pressed={appearance === "ios"} onClick={() => void saveSetting("appearance", "ios")}>
  <span><DeviceMobile size={17} /><strong>iPhone 系统</strong></span>
  <small>系统蓝、圆角卡片与清晰层级</small>
</button>
```

Add a button labeled `重新查看新手引导` that saves `{ progressWorkbenchOnboarding: "pending" }` and navigates to `/`.
Add `重要日期`, `长期目标`, and `专注计时` to `collectionLabels` so restored or deleted records have human-readable labels.

- [ ] **Step 5: Create scoped iPhone theme tokens**

```css
/* src/themes/ios.css */
:root[data-appearance="ios"] {
  --page-bg: #f2f2f7;
  --surface: #ffffff;
  --surface-raised: #ffffff;
  --text: #1c1c1e;
  --text-soft: #636366;
  --text-faint: #8e8e93;
  --border: rgba(60, 60, 67, .16);
  --accent: #007aff;
  --accent-deep: #0066d6;
  --accent-soft: rgba(0, 122, 255, .12);
  --success: #34c759;
  --warning: #ff9500;
  --danger: #ff3b30;
  --radius-panel: 22px;
  --shadow-panel: 0 8px 30px rgba(0, 0, 0, .07);
}
:root[data-appearance="ios"][data-theme="dark"] {
  --page-bg: #000000;
  --surface: #1c1c1e;
  --surface-raised: #2c2c2e;
  --text: #ffffff;
  --text-soft: #aeaeb2;
  --border: rgba(84, 84, 88, .65);
  --accent: #0a84ff;
  --success: #30d158;
  --warning: #ff9f0a;
  --danger: #ff453a;
}
```

Import `./themes/ios.css` after the base stylesheet and before theme-specific legacy files in `src/main.tsx`.

- [ ] **Step 6: Run appearance, shell, and settings component tests**

Run: `npm test -- tests/unit/appearance.test.ts tests/components/app-shell.test.tsx`

Expected: PASS for all four appearance branches.

- [ ] **Step 7: Commit the fourth appearance**

```bash
git add src/appearance.ts src/main.tsx src/components/Layout.tsx src/pages/SettingsPage.tsx src/themes/ios.css tests/unit/appearance.test.ts tests/components/app-shell.test.tsx
git commit -m "style: add iPhone system appearance"
```

### Task 5: 独立工作台面板和浏览器端时间模型

**Files:**
- Create: `src/features/workbench/model.ts`
- Create: `src/features/workbench/ProgressOverview.tsx`
- Create: `src/features/workbench/ImportantDatesPanel.tsx`
- Create: `src/features/workbench/LongTermGoalsPanel.tsx`
- Create: `src/features/workbench/FocusTimerPanel.tsx`
- Test: `tests/unit/workbench-model.test.ts`
- Test: `tests/components/dashboard-workbench.test.tsx`

**Interfaces:**
- Consumes: `DashboardData` and `FocusTimerSnapshot` from Tasks 2-3.
- Produces callback-only presentational panels; panels do not call APIs directly.
- Produces: `remainingAt(snapshot, nowMs): number` and `formatClock(seconds): string`.

- [ ] **Step 1: Write model tests for running, paused, and exhausted snapshots**

```ts
expect(formatClock(1500)).toBe("25:00");
expect(formatClock(65)).toBe("01:05");
expect(remainingAt({ status: "running", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:00.000Z" }, Date.parse("2026-08-15T01:00:30.000Z"))).toBe(90);
expect(remainingAt({ status: "paused", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:00.000Z" }, Date.parse("2026-08-15T01:10:00.000Z"))).toBe(120);
```

- [ ] **Step 2: Write component tests for empty progress and accessible actions**

```tsx
render(<ProgressOverview date="2026-08-15" overview={{ completed: 0, total: 0, progress: 0, scheduledMinutes: 0 }} onAddTask={vi.fn()} />);
expect(screen.getByText("还没有安排任务")).toBeInTheDocument();
expect(screen.queryByText("100%" )).not.toBeInTheDocument();

render(<ImportantDatesPanel items={[dateItem]} error={null} onAdd={onAdd} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />);
expect(screen.getByText("纪念日")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "编辑纪念日" })).toBeInTheDocument();
```

- [ ] **Step 3: Run model and component tests and confirm missing modules**

Run: `npm test -- tests/unit/workbench-model.test.ts tests/components/dashboard-workbench.test.tsx`

Expected: FAIL because the feature files do not exist.

- [ ] **Step 4: Implement time helpers and the progress overview**

```ts
// src/features/workbench/model.ts
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
export function remainingAt(snapshot: Pick<FocusTimerSnapshot, "status" | "remainingSeconds" | "snapshotAt">, nowMs: number): number {
  if (snapshot.status !== "running") return snapshot.remainingSeconds;
  const elapsed = Math.max(0, Math.floor((nowMs - Date.parse(snapshot.snapshotAt)) / 1000));
  return Math.max(0, snapshot.remainingSeconds - elapsed);
}
```

Render the progress ring as an SVG with `aria-label="今日完成进度 X%"`; when total is zero, render the required empty copy and an `添加今日任务` button.

- [ ] **Step 5: Implement dates and goals as controlled panels**

Each panel receives data, section error, and explicit callbacks. Date cards render `今天`, `已到期`, or `还有 N 天`; goal cards render a native progress element and status. Provide labeled edit, delete, move-up, and move-down buttons; disable impossible move actions.

```tsx
<progress aria-label={`${item.name}进度`} value={item.progress} max={100} />
<button aria-label={`编辑${item.name}`} onClick={() => onEdit(item)}><PencilSimple /></button>
<button aria-label={`删除${item.name}`} onClick={() => onDelete(item)}><Trash /></button>
```

- [ ] **Step 6: Implement the timer panel with one interval**

Use one `window.setInterval(..., 1000)` only while status is `running`, clear it on unmount or pause, and derive the display using `remainingAt`. Expose `onPause`, `onResume`, and `onFinish`; show the linked task title when available. When no timer exists, show “选择今日任务开始专注”。

```tsx
const [now, setNow] = useState(() => Date.now());
useEffect(() => {
  if (timer?.status !== "running") return;
  setNow(Date.now());
  const interval = window.setInterval(() => setNow(Date.now()), 1000);
  return () => window.clearInterval(interval);
}, [timer?.id, timer?.status]);
const remaining = timer ? remainingAt(timer, now) : 0;
return <strong aria-live="polite">{formatClock(remaining)}</strong>;
```

- [ ] **Step 7: Run focused component tests**

Run: `npm test -- tests/unit/workbench-model.test.ts tests/components/dashboard-workbench.test.tsx`

Expected: PASS with fake timers and no timer leak after unmount.

- [ ] **Step 8: Commit reusable panels**

```bash
git add src/features/workbench tests/unit/workbench-model.test.ts tests/components/dashboard-workbench.test.tsx
git commit -m "feat: build progress workbench panels"
```

### Task 6: 首页 CRUD、任务联动和计时控制

**Files:**
- Create: `src/features/workbench/WorkbenchDialogs.tsx`
- Modify: `src/pages/DashboardPage.tsx:1-130`
- Modify: `src/WorkspaceContext.tsx:40-52`
- Modify Test: `tests/components/dashboard-workbench.test.tsx`
- Modify Test: `tests/components/app-shell.test.tsx`

**Interfaces:**
- Consumes: panels from Task 5 and generic `api.create/update/remove`.
- Consumes: timer API from Task 3.
- Produces: complete dashboard CRUD and `开始专注` action on each unfinished task.

- [ ] **Step 1: Write an interaction test for preserving form input on save failure**

```tsx
await user.click(screen.getByRole("button", { name: "添加重要日期" }));
await user.type(screen.getByLabelText("日期名称"), "重要纪念日");
await user.type(screen.getByLabelText("目标日期"), "2026-10-01");
serverRejectNextSave("磁盘暂时不可写");
await user.click(screen.getByRole("button", { name: "保存重要日期" }));
expect(await screen.findByText("磁盘暂时不可写")).toBeInTheDocument();
expect(screen.getByLabelText("日期名称")).toHaveValue("重要纪念日");
```

Add interaction assertions for goal progress update; task edit, delete, and move ordering; delete confirmation; starting a 25-minute timer from a task; pausing, resuming, and finishing.

- [ ] **Step 2: Run the interaction test and confirm controls are absent**

Run: `npm test -- tests/components/dashboard-workbench.test.tsx`

Expected: FAIL because dialogs and dashboard orchestration do not exist.

- [ ] **Step 3: Implement controlled forms and delete confirmation**

```ts
export type WorkbenchDialogState =
  | { type: "importantDate"; item: Entity | null }
  | { type: "longTermGoal"; item: Entity | null }
  | { type: "planItem"; item: Entity }
  | { type: "delete"; collection: "importantDates" | "longTermGoals" | "planItems"; item: Entity }
  | null;
```

Use `react-hook-form` for each form, submit through a passed async callback, and keep the modal open with `formError` on rejection. Date fields are `name`, `target_date`, `recurrence`, `color`; goal fields are `name`, `target_date`, `progress`, `notes`, `status`; task fields are `title`, `start_time`, `estimated_minutes`, `priority`, `notes`. Preserve the task's existing `plan_date`, source linkage, completion fields, and status unless the corresponding visible control changes them.

- [ ] **Step 4: Insert the four new workbench layers into the formal dashboard**

Order the page as:

```tsx
<ProgressOverview ... />
<div className="workbench-pair"><ImportantDatesPanel ... /><LongTermGoalsPanel ... /></div>
<div className="workbench-focus-grid"><TodayTaskSections ... /><FocusTimerPanel ... /></div>
<ExistingQuickMemoAndAttention />
<ExistingModuleSummaries />
```

Keep the existing timeline, unscheduled tasks, quick memo autosave, attention list, and module summaries. Remove only duplicate headings or wrappers; do not remove their behaviors.

- [ ] **Step 5: Wire CRUD, ordering, and query invalidation**

Wrap writes with `run()`. Date, goal, and task reordering swaps adjacent `sort_order` values using two `api.update` calls inside one handler, then refreshes `workspace` and `dashboard`. Keep timed and unscheduled task sections separate; ordering applies within the current section. Extend `refreshSavedData()` to invalidate `['focusTimer']` if the dedicated current query is used.

```ts
async function swapOrder(collection: "importantDates" | "longTermGoals" | "planItems", first: Entity, second: Entity) {
  const firstOrder = Number(first.sort_order || 0);
  const secondOrder = Number(second.sort_order || 0);
  await Promise.all([
    api.update(collection, first.id, { sort_order: secondOrder }),
    api.update(collection, second.id, { sort_order: firstOrder }),
  ]);
}
```

- [ ] **Step 6: Add `开始专注` to unfinished task rows**

Each unfinished task row must expose labeled `编辑任务`, `删除任务`, `上移任务`, `下移任务`, and `开始专注` controls. Use `item.estimated_minutes` when it is between 1 and 480; otherwise use 25. Disable all start buttons while a timer is active. Timer panel callbacks call the exact Task 3 APIs through `run()`.

```tsx
<Button size="sm" variant="ghost" disabled={Boolean(activeTimer)} onClick={() => onStartFocus(item)}>
  <Timer size={15} />开始专注
</Button>
```

- [ ] **Step 7: Run dashboard component and integration tests**

Run: `npm test -- tests/components/dashboard-workbench.test.tsx tests/components/app-shell.test.tsx tests/integration/planning-dashboard.test.ts`

Expected: PASS; failed saves retain input and successful actions update only the affected dashboard content.

- [ ] **Step 8: Commit formal dashboard integration**

```bash
git add src/features/workbench/WorkbenchDialogs.tsx src/pages/DashboardPage.tsx src/WorkspaceContext.tsx tests/components/dashboard-workbench.test.tsx tests/components/app-shell.test.tsx
git commit -m "feat: integrate progress workbench dashboard"
```

### Task 7: 三步首次引导与重新查看

**Files:**
- Create: `src/features/workbench/OnboardingModal.tsx`
- Modify: `src/pages/DashboardPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Test: `tests/components/onboarding.test.tsx`

**Interfaces:**
- Consumes: settings key `progressWorkbenchOnboarding` and date/goal API from earlier tasks.
- Produces: values `pending`, `completed`, `skipped`; only `pending` or missing opens the modal.

- [ ] **Step 1: Write the complete, skip, and reopen tests**

```tsx
expect(await screen.findByRole("dialog", { name: "欢迎使用新的进度工作台" })).toBeInTheDocument();
await user.click(screen.getByRole("button", { name: "跳过引导" }));
expect(fetchMock).toHaveBeenCalledWith("/api/settings", expect.objectContaining({ body: JSON.stringify({ progressWorkbenchOnboarding: "skipped" }) }));

// completed or skipped settings must not reopen automatically.
// clicking “重新查看新手引导” saves pending and navigating home opens it again.
```

- [ ] **Step 2: Run the onboarding test and confirm the modal is missing**

Run: `npm test -- tests/components/onboarding.test.tsx`

Expected: FAIL because `OnboardingModal` does not exist.

- [ ] **Step 3: Implement the three explicit steps**

Step 1 shows the iPhone system appearance and unified icon. Step 2 collects optional important-date `name` and `target_date`. Step 3 collects optional goal `name`, `target_date`, and initial `progress`. `下一步` creates provided content; empty optional forms advance without writes. `完成` saves `completed`; the persistent `跳过引导` control saves `skipped`.

```ts
const shouldOpen = !["completed", "skipped"].includes(data.settings.progressWorkbenchOnboarding);
const finish = (status: "completed" | "skipped") => run(() => api.saveSettings({ progressWorkbenchOnboarding: status }));
```

- [ ] **Step 4: Mount onboarding after dashboard data is available**

Mount it at the end of `DashboardPage`. Do not open it during skeleton or fatal dashboard error states. After date or goal creation, invalidate workspace and dashboard before advancing.

- [ ] **Step 5: Verify focus management and reopening**

Run: `npm test -- tests/components/onboarding.test.tsx tests/components/ui.test.tsx tests/components/dashboard-workbench.test.tsx`

Expected: PASS; Escape, Tab trapping, skip, finish, and settings reopen work without duplicate dialogs.

- [ ] **Step 6: Commit onboarding**

```bash
git add src/features/workbench/OnboardingModal.tsx src/pages/DashboardPage.tsx src/pages/SettingsPage.tsx tests/components/onboarding.test.tsx
git commit -m "feat: add progress workbench onboarding"
```

### Task 8: iPhone 页面细节、响应式验收和完整回归

**Files:**
- Modify: `src/themes/ios.css`
- Modify: `src/styles.css:965-1100`
- Modify: `src/neo.css:740-810`
- Modify: `src/themes/notebook.css:740-810`
- Modify: `tests/e2e/acceptance.spec.ts:40-330`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: final dashboard class names and four appearances.
- Produces: verified desktop/narrow layout, reduced motion, theme isolation, desktop-launch-compatible production bundle.

- [ ] **Step 1: Add failing end-to-end expectations for the new formal homepage**

```ts
await request.put("/api/settings", { data: { appearance: "ios", theme: "light", progressWorkbenchOnboarding: "skipped" } });
await page.goto("/");
await expect(page.locator("html")).toHaveAttribute("data-appearance", "ios");
await expect(page.getByText("今日进度")).toBeVisible();
await expect(page.getByText("重要日期")).toBeVisible();
await expect(page.getByText("长期目标")).toBeVisible();
await expect(page.getByText("专注计时")).toBeVisible();
```

Add a 390×844 viewport check that panels are single-column and have no horizontal overflow. Loop through `ios`, `liquid`, `notebook`, `neo` and verify the dashboard remains operable.

- [ ] **Step 2: Run the focused e2e test and capture the layout failures**

Run: `npm run test:e2e -- --grep "progress workbench|four appearances"`

Expected: FAIL until final class-specific CSS is complete.

- [ ] **Step 3: Finish scoped iPhone workbench styles**

```css
:root[data-appearance="ios"] .workbench-overview,
:root[data-appearance="ios"] .workbench-panel,
:root[data-appearance="ios"] .focus-timer-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-panel);
  background: var(--surface);
  box-shadow: var(--shadow-panel);
}
.workbench-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.workbench-focus-grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .7fr); gap: 16px; }
@media (max-width: 760px) {
  .workbench-pair, .workbench-focus-grid { grid-template-columns: 1fr; }
  .workbench-overview { padding: 20px; }
}
@media (prefers-reduced-motion: reduce) {
  :root[data-appearance="ios"] *, :root[data-appearance="ios"] *::before, :root[data-appearance="ios"] *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }
}
```

Keep shared structural CSS in `styles.css`; add only narrowly scoped compatibility rules to Notebook and Neo files so their existing visual language remains unchanged.

- [ ] **Step 4: Run the full component, integration, and e2e suites**

Run: `npm run test`

Expected: all Vitest tests pass.

Run: `npm run test:e2e`

Expected: all Chromium acceptance tests pass at desktop and narrow widths.

- [ ] **Step 5: Run static, production, and desktop-launch regression checks**

Run: `npm run verify`

Expected: lint, both TypeScript builds, all tests, Vite build, rendered HTML, and production launcher tests pass.

Run: `powershell -ExecutionPolicy Bypass -File tests/windows-shortcut.test.ps1`

Expected: shortcut target, working directory, icon, launcher, and local production URL checks pass.

- [ ] **Step 6: Inspect the final formal app manually**

Start the existing desktop launcher, open `http://127.0.0.1:4317/`, and verify:

- iPhone system appearance is active after the one-time migration.
- Existing task, memo, module, reading, reflection, backup, export, and icon content is still present.
- Adding a date and goal survives a page refresh.
- Starting, pausing, refreshing, resuming, and ending a focus timer preserves correct time.
- Switching through all four appearances keeps the same data and controls.
- The browser console contains no errors.

- [ ] **Step 7: Commit final styling and acceptance coverage**

```bash
git add src/themes/ios.css src/styles.css src/neo.css src/themes/notebook.css tests/e2e/acceptance.spec.ts tests/rendered-html.test.mjs
git commit -m "test: verify iPhone progress workbench rollout"
```

## Completion Check

Before reporting completion, compare the implementation against `docs/superpowers/specs/2026-08-15-ios-progress-workbench-integration-design.md` and confirm every design section maps to a passing task above. Preserve the existing untracked `.superpowers/brainstorm` files and do not include them in any commit.
