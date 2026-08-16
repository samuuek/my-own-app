# Vercel + Neon Cloud Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing personal workspace to a private Vercel Hobby production URL backed by Neon Free and private Vercel Blob, with a verified one-time copy of the current desktop data.

**Architecture:** Keep the desktop Fastify + SQLite composition unchanged. Add a cloud Fastify composition whose asynchronous store uses Neon Postgres, whose reading files use private Vercel Blob, and whose API contract remains compatible with the React frontend. A one-time migration package copies a verified SQLite backup into Neon; Vercel Authentication protects the whole deployment.

**Tech Stack:** React 19, Vite 7, Fastify 5, TypeScript 5.9, Vitest, `@neondatabase/serverless`, `@vercel/blob`, Neon Postgres, Vercel Node.js Functions, Vercel Hobby.

## Global Constraints

- Vercel must remain on Hobby; Neon must remain on Free; Blob must remain within Hobby free usage.
- Stop before any trial, paid upgrade, payment-method requirement, domain purchase, or metered add-on.
- Preserve `C:\Users\76518\AppData\Local\MuziWorkspace` and the desktop shortcut; never delete or overwrite the local SQLite database.
- Migration is one-way and one-time. After import, desktop SQLite and cloud Postgres are independent.
- Never print, commit, or summarize `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, Vercel tokens, or connection strings.
- Protect production and preview deployments with Vercel Authentication before importing personal data.
- Keep the existing `/api/*` browser contract and the four existing appearances.
- Use pooled Neon connection data and close interactive connections before each Vercel Function request completes.
- Apply schema changes through a Neon temporary branch, verify them, request migration commit approval, and only then apply to the main branch.
- Preserve all unrelated and `.superpowers/brainstorm` working-tree files.

---

### Task 1: Stabilize the iPhone workbench baseline

**Files:**
- Modify: `src/styles.css`
- Modify: `src/themes/ios.css`
- Modify: `src/themes/notebook.css`
- Modify: `src/neo.css`
- Test: `tests/e2e/acceptance.spec.ts`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: the uncommitted responsive workbench changes already present in the working tree.
- Produces: a clean committed UI baseline that later cloud work can build and deploy.

- [ ] **Step 1: Verify the exact pending scope**

Run:

```powershell
git diff -- src/styles.css src/themes/ios.css src/themes/notebook.css src/neo.css tests/e2e/acceptance.spec.ts tests/rendered-html.test.mjs
git diff --check
```

Expected: only workbench styling and its acceptance/static assertions appear; no whitespace errors.

- [ ] **Step 2: Run the baseline verification**

Run:

```powershell
npm run verify
node --test tests/app-icon-assets.test.mjs
```

Expected: both commands exit 0. If Playwright Chromium is unavailable, record that separately; `npm run verify` must still pass.

- [ ] **Step 3: Check desktop and narrow layouts in the in-app Browser**

Verify at 1440×900 and 390×844:

```text
appearance = ios
document.documentElement.scrollWidth = window.innerWidth
headings include 今日进度 / 重要日期 / 长期目标 / 专注计时
添加重要日期 opens and closes its dialog
console errors = 0
```

Expected: two-column desktop pair, one-column mobile pair, no page overflow.

- [ ] **Step 4: Commit only the baseline files**

```powershell
git add -- src/styles.css src/themes/ios.css src/themes/notebook.css src/neo.css tests/e2e/acceptance.spec.ts tests/rendered-html.test.mjs
git commit -m "test: verify iPhone progress workbench rollout"
```

Expected: `.superpowers/brainstorm` remains untracked and unchanged.

---

### Task 2: Add the cloud runtime boundary and Postgres schema

**Files:**
- Create: `.env.example`
- Create: `database/cloud/001_workspace.sql`
- Create: `server/cloud/config.ts`
- Create: `server/cloud/database.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.server.json`
- Test: `tests/unit/cloud-config.test.ts`
- Test: `tests/unit/cloud-schema.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and `MUZI_RUNTIME=cloud` from Vercel-managed environment variables.
- Produces: `readCloudConfig(env): CloudConfig` and `CloudDatabase.query/transaction`, used by every later cloud service.

- [ ] **Step 1: Write failing cloud configuration tests**

Add tests equivalent to:

```ts
expect(() => readCloudConfig({ MUZI_RUNTIME: "cloud" })).toThrow("DATABASE_URL");
expect(readCloudConfig({
  MUZI_RUNTIME: "cloud",
  DATABASE_URL: "postgresql://example.invalid/db",
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
})).toMatchObject({ runtime: "cloud", blobEnabled: true });
```

Run:

```powershell
npx vitest run tests/unit/cloud-config.test.ts
```

Expected: FAIL because `server/cloud/config.ts` does not exist.

- [ ] **Step 2: Add explicit environment names and dependencies**

Create `.env.example` with names only:

```dotenv
MUZI_RUNTIME=cloud
DATABASE_URL=
BLOB_READ_WRITE_TOKEN=
```

Install:

```powershell
npm install @neondatabase/serverless @vercel/blob ws
npm install --save-dev @types/ws vercel
```

Update `tsconfig.server.json` to include `server.ts`, `server/**/*.ts`, and `scripts/**/*.ts` while retaining NodeNext settings.

- [ ] **Step 3: Implement strict cloud configuration**

Create:

```ts
export type CloudConfig = {
  runtime: "cloud";
  databaseUrl: string;
  blobEnabled: boolean;
};

export function readCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  if (env.MUZI_RUNTIME !== "cloud") throw new Error("MUZI_RUNTIME 必须设置为 cloud");
  if (!env.DATABASE_URL) throw new Error("缺少 DATABASE_URL");
  return { runtime: "cloud", databaseUrl: env.DATABASE_URL, blobEnabled: Boolean(env.BLOB_READ_WRITE_TOKEN) };
}
```

Do not return or log the connection string from health/status endpoints.

- [ ] **Step 4: Write the schema assertion test**

Assert `database/cloud/001_workspace.sql` contains all of:

```text
workspace_schema_migrations
workspace_entities
workspace_settings
workspace_daily_reviews
PRIMARY KEY (collection, id)
payload JSONB
idx_workspace_entities_active
idx_workspace_entities_updated
uq_workspace_active_focus_timer
```

Run:

```powershell
npx vitest run tests/unit/cloud-schema.test.ts
```

Expected: FAIL because the SQL file does not exist.

- [ ] **Step 5: Add a compact JSONB schema for the existing entity contract**

Create SQL with this shape:

```sql
CREATE TABLE IF NOT EXISTS workspace_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_entities (
  collection text NOT NULL,
  id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  PRIMARY KEY (collection, id),
  CHECK (payload->>'id' = id)
);

CREATE TABLE IF NOT EXISTS workspace_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_daily_reviews (
  review_date date PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_entities_active
  ON workspace_entities (collection, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_entities_updated
  ON workspace_entities (updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_active_focus_timer
  ON workspace_entities (collection)
  WHERE collection = 'focusTimers'
    AND deleted_at IS NULL
    AND payload->>'status' IN ('running', 'paused');
```

Append an idempotent insert for migration version `001_workspace`.

- [ ] **Step 6: Implement the Neon database adapter**

Expose:

```ts
export type QueryResult<T> = { rows: T[] };
export interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}
export class CloudDatabase implements Queryable {
  query<T>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
  transaction<T>(work: (transaction: Queryable) => Promise<T>): Promise<T>;
}
```

Use Neon HTTP `sql.query` for one-shot queries. For `transaction`, create a request-scoped `Pool`, execute `BEGIN`, run the callback through the connected client, `COMMIT` or `ROLLBACK`, release the client, and `await pool.end()` in `finally`. Configure `neonConfig.webSocketConstructor = ws` once. Never create a reusable WebSocket pool at module scope.

- [ ] **Step 7: Run focused and full type checks**

```powershell
npx vitest run tests/unit/cloud-config.test.ts tests/unit/cloud-schema.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add -- .env.example database/cloud/001_workspace.sql server/cloud/config.ts server/cloud/database.ts package.json package-lock.json tsconfig.server.json tests/unit/cloud-config.test.ts tests/unit/cloud-schema.test.ts
git commit -m "feat: add Neon cloud runtime foundation"
```

---

### Task 3: Implement the asynchronous cloud store

**Files:**
- Create: `server/cloud/store.ts`
- Create: `server/cloud/store-validation.ts`
- Test: `tests/unit/cloud-store.test.ts`
- Test: `tests/integration/cloud-store-contract.test.ts`

**Interfaces:**
- Consumes: `Queryable` and `CloudDatabase.transaction` from Task 2; existing `collectionDefinitions`, `validateWorkbenchEntity`, `validateBookProgress`, and source mappings.
- Produces: `CloudStore`, whose async methods mirror `AppStore`: `list`, `get`, `create`, `update`, `softDelete`, `restore`, `permanentDelete`, `trash`, `getSettings`, `setSettings`, `getDailyReview`, `setDailyReview`, `state`, `search`, and `sourceTitle`.

- [ ] **Step 1: Write failing CRUD contract tests with a recording Queryable**

Cover these exact behaviors:

```ts
await store.create("importantDates", { title: "纪念日", target_date: "2026-09-01" });
await store.update("longTermGoals", goalId, { progress: 60 });
await store.softDelete("planItems", planId);
await store.restore("planItems", planId);
await store.permanentDelete("planItems", planId);
```

Assertions:

```text
unknown fields are stripped
required fields are rejected
timestamps are ISO strings
payload id matches row id
soft deleted rows are omitted unless includeDeleted=true
trash derives display_title from collectionDefinitions
planItems get the next sort_order for the same plan_date
```

Run:

```powershell
npx vitest run tests/unit/cloud-store.test.ts
```

Expected: FAIL because `CloudStore` does not exist.

- [ ] **Step 2: Implement safe JSONB persistence**

Use parameterized SQL only. The create statement must be equivalent to:

```sql
INSERT INTO workspace_entities(collection, id, payload, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, NULL)
RETURNING payload;
```

Updates must replace the merged full payload and update the duplicated `updated_at`/`deleted_at` columns in the same statement. Collection names must be validated with `isCollectionName` before they reach SQL.

- [ ] **Step 3: Implement parent visibility, settings, reviews, state, and search**

Match desktop semantics:

```text
readingSessions / readingNotes hide rows whose book is deleted
reflectionActions hide rows whose daily reflection is deleted
state returns every CollectionName plus settings and trash
planItems include display_title resolved from source entities
search returns collection, module, title, id, and updated_at, at most 20 per collection
```

Use case-insensitive JavaScript matching on the small JSONB result set to keep field handling identical across SQLite and Postgres.

- [ ] **Step 4: Add a store transaction helper**

Expose:

```ts
async transaction<T>(work: (store: CloudStore) => Promise<T>): Promise<T> {
  return this.database.transaction((queryable) => work(new CloudStore(queryable)));
}
```

Use it for soft-delete metadata changes and every multi-record workflow in Task 4.

- [ ] **Step 5: Run focused tests**

```powershell
npx vitest run tests/unit/cloud-store.test.ts tests/integration/cloud-store-contract.test.ts
npm run typecheck
```

Expected: PASS with no real Neon connection required.

- [ ] **Step 6: Commit**

```powershell
git add -- server/cloud/store.ts server/cloud/store-validation.ts tests/unit/cloud-store.test.ts tests/integration/cloud-store-contract.test.ts
git commit -m "feat: add asynchronous cloud data store"
```

---

### Task 4: Port dashboard and domain workflows to the cloud store

**Files:**
- Modify: `server/dashboard.ts`
- Create: `server/cloud/dashboard.ts`
- Create: `server/cloud/focus-timer.ts`
- Create: `server/cloud/workflows.ts`
- Test: `tests/unit/cloud-dashboard.test.ts`
- Test: `tests/unit/cloud-focus-timer.test.ts`
- Test: `tests/integration/cloud-workflows.test.ts`

**Interfaces:**
- Consumes: `CloudStore` from Task 3 and existing pure validators/calculators.
- Produces: `buildCloudDashboard`, `CloudFocusTimerService`, and transactional workflow methods used by the cloud API.

- [ ] **Step 1: Extract a pure dashboard assembler behind the existing local API**

Add:

```ts
export type DashboardCollections = Partial<Record<CollectionName, Entity[]>>;
export function buildDashboardFromCollections(
  collections: DashboardCollections,
  date: string,
  activeFocusTimer: FocusTimerSnapshot | null,
): Record<string, any>;
```

Keep `buildDashboard(store, date, readTimer)` as a synchronous wrapper so all desktop tests remain unchanged.

Write a failing test that gives the assembler plan items, important dates, goals, and a timer and expects the same overview/sections as the current dashboard.

- [ ] **Step 2: Implement the cloud dashboard loader**

Load all required collections concurrently with `Promise.all`, call `buildDashboardFromCollections`, and isolate errors for `importantDates`, `longTermGoals`, and `focusTimer` exactly as the local dashboard does.

- [ ] **Step 3: Write failing cloud focus timer tests**

Test start, pause, resume, complete, cancel, remaining seconds, and rejection of a second active timer. Use fixed `Date` instances and a fake `CloudStore`.

Expected first run:

```powershell
npx vitest run tests/unit/cloud-focus-timer.test.ts
```

FAIL because `CloudFocusTimerService` does not exist.

- [ ] **Step 4: Implement CloudFocusTimerService**

Mirror the public signatures of `FocusTimerService`, returning promises:

```ts
current(now?: Date): Promise<FocusTimerSnapshot | null>;
start(input: { planItemId: string | null; plannedMinutes: number }, now?: Date): Promise<FocusTimerSnapshot>;
pause(id: string, now?: Date): Promise<FocusTimerSnapshot>;
resume(id: string, now?: Date): Promise<FocusTimerSnapshot>;
finish(id: string, status: "completed" | "cancelled", now?: Date): Promise<FocusTimerSnapshot>;
```

Run start/finish state changes in `CloudStore.transaction`.

- [ ] **Step 5: Implement transactional cloud workflows**

Create these methods with the same returned shapes as `server/app.ts`:

```ts
completePlan(id: string): Promise<Entity>;
recordReadingProgress(bookId: string, input: Entity): Promise<{ book: Entity; session: Entity; stats: Record<string, any>; suggestCompletion: boolean }>;
saveDailyReflection(input: Entity): Promise<{ reflection: Entity; actions: Entity[] }>;
addReflectionActionToPlan(actionId: string): Promise<Entity>;
postponePlan(id: string, date: string): Promise<Entity>;
convertQuickMemo(id: string, collection: CollectionName, fields: Entity): Promise<Entity>;
```

Each method must call `store.transaction` once and perform every dependent read/write through the transaction-bound store.

- [ ] **Step 6: Run focused and desktop regression tests**

```powershell
npx vitest run tests/unit/cloud-dashboard.test.ts tests/unit/cloud-focus-timer.test.ts tests/integration/cloud-workflows.test.ts
npx vitest run tests/integration/planning-dashboard.test.ts tests/integration/reading-files.test.ts tests/unit/focus-timer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- server/dashboard.ts server/cloud/dashboard.ts server/cloud/focus-timer.ts server/cloud/workflows.ts tests/unit/cloud-dashboard.test.ts tests/unit/cloud-focus-timer.test.ts tests/integration/cloud-workflows.test.ts
git commit -m "feat: port workspace workflows to Neon"
```

---

### Task 5: Add private Blob files and the cloud Fastify application

**Files:**
- Create: `server/cloud/reading-files.ts`
- Create: `server/cloud/export.ts`
- Create: `server/cloud/system.ts`
- Create: `server/cloud/app.ts`
- Create: `server.ts`
- Create: `vercel.json`
- Modify: `server/app.ts`
- Modify: `src/api.ts`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/WorkspaceContext.tsx`
- Test: `tests/unit/cloud-reading-files.test.ts`
- Test: `tests/unit/cloud-export.test.ts`
- Test: `tests/integration/cloud-app.test.ts`
- Test: `tests/components/cloud-settings.test.tsx`
- Test: `tests/components/cloud-error-state.test.tsx`

**Interfaces:**
- Consumes: CloudStore/services from Tasks 3–4, `@vercel/blob`, and the built `dist` directory.
- Produces: the Vercel entrypoint and a cloud API with the same routes as the desktop API.

- [ ] **Step 1: Write failing private file tests**

Inject a Blob client with `put/get/del` methods. Test:

```text
PDF must begin with %PDF- and be <= 100 MB
cover must be PNG/JPEG/WebP and be <= 10 MB
put uses access: private and addRandomSuffix: true
database update occurs after successful upload
old blob is deleted only after the new metadata is saved
remove clears book metadata and deletes the blob
```

Run:

```powershell
npx vitest run tests/unit/cloud-reading-files.test.ts
```

Expected: FAIL because `CloudReadingFileManager` does not exist.

- [ ] **Step 2: Implement private Blob reading files**

Expose async methods matching local file behavior:

```ts
savePdf(bookId: string, content: Buffer, originalName: string): Promise<Entity>;
readPdf(bookId: string): Promise<{ book: Entity; body: ReadableStream; contentType: string }>;
removePdf(bookId: string): Promise<Entity>;
saveCover(bookId: string, content: Buffer, contentType: string, originalName: string): Promise<Entity>;
readCover(bookId: string): Promise<{ body: ReadableStream; contentType: string }>;
removeCover(bookId: string): Promise<Entity>;
removeBookFiles(book: Entity): Promise<void>;
```

Store only the private blob pathname in existing `pdf_file_id`/`cover_file_id` fields.

- [ ] **Step 3: Write failing cloud route tests**

Build `buildCloudApp({ store, focusTimers, files, serveStatic: false })` with fakes and verify:

```text
GET /api/health reports application, runtime=cloud, database=connected, and no secret
GET /api/state returns WorkspaceState
POST/PATCH/DELETE collection routes await CloudStore
same-origin HTTPS writes are accepted
foreign Origin writes return 403
local-only system actions return 409 with code DESKTOP_ONLY
GET /api/backups returns []
```

- [ ] **Step 4: Implement authenticated cloud export**

Create `CloudExportService` with:

```ts
create(): Promise<{ filename: string; path: "private-cloud"; size: number; downloadUrl: string }>;
read(token: string): Promise<{ body: ReadableStream; filename: string }>;
```

Build the same `manifest.json`, `all-data.json`, and per-collection CSV files as the desktop export, upload the ZIP to private Blob under `exports/`, and return an API download URL containing a base64url token for the private pathname. `read` must decode the token, require the pathname to start with `exports/`, and stream it through the authenticated API. Add a test that rejects a token resolving outside `exports/` and verifies exported JSON contains cloud state.

- [ ] **Step 5: Implement the cloud Fastify API**

Port every `/api/*` route from `server/app.ts`, await the cloud services, preserve Zod validation and response shapes, and stream private Blob downloads through authenticated routes. Keep desktop `buildApp` unchanged except for sharing a pure origin-check helper if useful.

Cloud status shape:

```ts
{
  mode: "cloud",
  database: { provider: "Neon", status: "connected" },
  fileStorage: { provider: "Vercel Blob", status: "connected" },
  recovery: { provider: "Neon restore window" }
}
```

Implement `POST /api/export` through `CloudExportService.create` and `GET /api/cloud-exports/:token` through `CloudExportService.read`; preserve the existing response expected by `api.exportAll`.

- [ ] **Step 6: Add the Vercel entrypoint and function packaging**

Create root `server.ts`:

```ts
import { buildCloudApp } from "./server/cloud/app.js";
export default await buildCloudApp({ serveStatic: true });
```

Create `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm run build",
  "functions": {
    "server.ts": {
      "includeFiles": ["dist/**", "database/cloud/**"]
    }
  }
}
```

The cloud app must register `@fastify/static` for `dist` and preserve the API/asset 404 behavior from the desktop app.

- [ ] **Step 7: Render cloud-aware settings**

Add a discriminated system-status type in `src/api.ts`. In `SettingsPage`:

```text
cloud mode shows Neon / Vercel Blob / protected cloud copy
cloud mode hides local path, open directory, local backup, restore, and save-and-exit controls
desktop mode keeps current UI unchanged
export remains available in both modes
```

Update `WorkspaceContext.saveNow` so cloud mode can acknowledge saved server state without invoking desktop exit behavior.

Add a refetch-error test that first renders a nonempty cached workspace, then makes `/api/state` fail and verifies the existing task remains visible while a retry message is shown. The provider must never replace cached data with `emptyState` merely because a cloud refetch failed.

- [ ] **Step 8: Run route, UI, and full tests**

```powershell
npx vitest run tests/unit/cloud-reading-files.test.ts tests/unit/cloud-export.test.ts tests/integration/cloud-app.test.ts tests/components/cloud-settings.test.tsx tests/components/cloud-error-state.test.tsx
npm run verify
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add -- server/cloud/reading-files.ts server/cloud/export.ts server/cloud/system.ts server/cloud/app.ts server.ts vercel.json server/app.ts src/api.ts src/pages/SettingsPage.tsx src/WorkspaceContext.tsx tests/unit/cloud-reading-files.test.ts tests/unit/cloud-export.test.ts tests/integration/cloud-app.test.ts tests/components/cloud-settings.test.tsx tests/components/cloud-error-state.test.tsx
git commit -m "feat: add private Vercel cloud application"
```

---

### Task 6: Build a verifiable one-time SQLite migration package

**Files:**
- Create: `scripts/export-cloud-data.ts`
- Create: `scripts/import-cloud-data.ts`
- Create: `scripts/verify-cloud-data.ts`
- Modify: `package.json`
- Modify: `.gitignore`
- Test: `tests/integration/cloud-migration-package.test.ts`

**Interfaces:**
- Consumes: an explicit read-only SQLite backup path and `DATABASE_URL` supplied through `vercel env run`.
- Produces: a temporary JSON package with `manifest`, `collections`, `settings`, and `dailyReviews`; imports it idempotently into `workspace_*` tables; verifies collection counts and hashes.

- [ ] **Step 1: Write a failing migration-package test**

Create a temporary SQLite database with migrations, add one normal row, one deleted row, settings, and a daily review. Expect:

```ts
expect(pkg.manifest.formatVersion).toBe(1);
expect(pkg.manifest.sourceIntegrity).toBe("ok");
expect(pkg.collections.planItems).toHaveLength(2);
expect(pkg.settings.appearance).toBe("ios");
expect(pkg.counts.planItems).toEqual({ active: 1, deleted: 1, total: 2 });
expect(pkg.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
```

Run:

```powershell
npx vitest run tests/integration/cloud-migration-package.test.ts
```

Expected: FAIL because the exporter does not exist.

- [ ] **Step 2: Implement read-only export from an explicit backup**

The exporter must:

```text
open with readonly=true and fileMustExist=true
run PRAGMA integrity_check
read every table from collectionDefinitions with deleted rows included
parse settings JSON values
read daily_reviews
write only to the explicit output path
include per-collection active/deleted/total counts and a SHA-256 of canonical content
never inspect the live database when a backup path is supplied
```

- [ ] **Step 3: Implement idempotent cloud import**

For each entity, use:

```sql
INSERT INTO workspace_entities(collection, id, payload, created_at, updated_at, deleted_at)
VALUES ($1, $2, $3::jsonb, $4::timestamptz, $5::timestamptz, $6::timestamptz)
ON CONFLICT(collection, id) DO UPDATE SET
  payload = EXCLUDED.payload,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  deleted_at = EXCLUDED.deleted_at;
```

Import batches inside `CloudDatabase.transaction`. Upsert settings and reviews. Reject a package if its hash or format version is invalid. Never print `DATABASE_URL`.

- [ ] **Step 4: Implement count/hash verification**

`verify-cloud-data.ts` must print only collection names and counts, then exit nonzero if any total differs. It must query a deterministic ordered JSON aggregation and compare the imported canonical hash to the package hash.

- [ ] **Step 5: Add scripts and ignore migration artifacts**

Add:

```json
{
  "cloud:export": "tsx scripts/export-cloud-data.ts",
  "cloud:import": "tsx scripts/import-cloud-data.ts",
  "cloud:verify": "tsx scripts/verify-cloud-data.ts"
}
```

Ignore `/migration-output/` and `muzi-cloud-migration-*.json`.

- [ ] **Step 6: Run tests and commit**

```powershell
npx vitest run tests/integration/cloud-migration-package.test.ts
npm run typecheck
git add -- scripts/export-cloud-data.ts scripts/import-cloud-data.ts scripts/verify-cloud-data.ts package.json .gitignore tests/integration/cloud-migration-package.test.ts
git commit -m "feat: add verified SQLite cloud migration"
```

Expected: PASS and commit succeeds.

---

### Task 7: Link free Vercel, Neon, and private Blob resources

**Files:**
- Create via tooling, ignored by git: `.vercel/project.json`
- Create via tooling, ignored by git: `.env.local`
- Create: `docs/deployment/vercel-hobby.md`

**Interfaces:**
- Consumes: the authenticated Vercel Hobby team `765180987zgb-3076s-projects` and the approved Neon plugin.
- Produces: a linked Vercel project, Neon Free resource, private Blob store, and the required environment key names in all targets.

- [ ] **Step 1: Confirm CLI authentication and exact plan**

```powershell
npx vercel --version
npx vercel whoami
npx vercel teams ls
```

Expected: authenticated account and team `765180987zgb-3076s-projects`. If browser login is requested, allow the user to complete it and wait for the CLI to resume.

- [ ] **Step 2: Create/link the Vercel Hobby project before provisioning resources**

```powershell
npx vercel link --yes --scope 765180987zgb-3076s-projects --project samuel-workbench
npx vercel project inspect samuel-workbench
```

Expected: `.vercel/project.json` exists and names the selected team/project; the project plan is Hobby.

- [ ] **Step 3: Enable protection before personal data is attached**

```powershell
npx vercel project protection enable samuel-workbench --sso
npx vercel project protection samuel-workbench --format json
```

Expected: Vercel Authentication covers production deployment URLs and previews. Do not configure password protection because it is not required and may be paid.

- [ ] **Step 4: Provision the Vercel-managed Neon default free resource**

```powershell
npx vercel integration guide neon
npx vercel integration add neon --name samuel-workbench-db --scope 765180987zgb-3076s-projects
npx vercel integration list samuel-workbench --format json
```

Expected: the integration reports Neon Free/default-free before proceeding and is connected to production, preview, and development. Stop if terms present a nonzero charge or request payment details.

- [ ] **Step 5: Create private Blob storage**

```powershell
npx vercel blob create-store samuel-workbench-files --access private
npx vercel integration list samuel-workbench --format json
```

Expected: private access and Hobby included usage. Stop if a payment method is requested.

- [ ] **Step 6: Pull and verify environment names without exposing values**

```powershell
npx vercel env pull .env.local --yes --environment development
```

Compare names in `.env.example` with `.env.local`. Expected present keys:

```text
DATABASE_URL
BLOB_READ_WRITE_TOKEN
```

Set `MUZI_RUNTIME=cloud` for development, preview, and production through `vercel env add`, using stdin so the value is not echoed. Pull again and confirm 3 required, 3 present, 0 missing.

- [ ] **Step 7: Document only non-secret resource metadata and commit**

`docs/deployment/vercel-hobby.md` records team slug, project name, provider names, free-plan checks, environment key names, migration commands, rollback procedure, and no values.

```powershell
git add -- docs/deployment/vercel-hobby.md
git commit -m "docs: record free Vercel deployment setup"
```

---

### Task 8: Validate and apply the Neon schema migration

**Files:**
- Read: `database/cloud/001_workspace.sql`
- Read: `.vercel/project.json`
- No secret values written to git.

**Interfaces:**
- Consumes: the linked Neon project and `001_workspace.sql`.
- Produces: verified `workspace_*` tables on the Neon main branch.

- [ ] **Step 1: Locate the Vercel-managed Neon project through the Neon plugin**

Search for `samuel-workbench-db`, describe the project, and record project ID, database name, main branch ID, Postgres version, and Free plan. Do not output a connection string.

- [ ] **Step 2: Prepare the migration on a Neon temporary branch**

Call `prepare_database_migration` with the full contents of `database/cloud/001_workspace.sql` and database `neondb` (or the described default database).

Expected: a migration ID, temporary branch name, temporary branch ID, and successful schema application.

- [ ] **Step 3: Verify the temporary branch**

Use `run_sql` on the returned temporary branch ID:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'workspace_%'
ORDER BY table_name;
```

Then verify `uq_workspace_active_focus_timer` exists and insert/update/delete a temporary test entity inside a transaction. Expected: all four tables and three indexes are present; test transaction succeeds.

- [ ] **Step 4: Request explicit migration commit approval**

Show the required migration ID, temporary branch name/ID, and success result without SQL details. Wait for user approval as required by the Neon migration workflow.

- [ ] **Step 5: Apply the exact prepared migration to main**

Call `complete_database_migration` with every exact value returned by prepare and `applyChanges: true`.

Expected: migration applied and temporary branch cleaned up.

- [ ] **Step 6: Verify main schema**

Use `describe_branch` and `run_sql` against the main branch. Expected: schema matches the temporary branch and `workspace_schema_migrations` contains `001_workspace` exactly once.

---

### Task 9: Back up, copy, and verify the current desktop data

**Files:**
- Read only: `C:\Users\76518\AppData\Local\MuziWorkspace\data\app.sqlite`
- Create outside git: `%TEMP%\muzi-cloud-migration-2026-08-16.json`
- Create through the app: a retained backup under `C:\Users\76518\AppData\Local\MuziWorkspace\backups`

**Interfaces:**
- Consumes: migration tools from Task 6 and verified Neon schema from Task 8.
- Produces: a verified cloud copy with counts/hashes matching the backup.

- [ ] **Step 1: Save and create a retained migration backup**

Ensure the desktop service is running, then call:

```text
POST http://127.0.0.1:4317/api/system/save
POST http://127.0.0.1:4317/api/backups
body: { "label": "云端迁移前备份", "keep": true }
```

Capture the response as `$migrationBackup`, resolve `$backupRoot = Join-Path $env:LOCALAPPDATA 'MuziWorkspace\backups'`, and resolve `$backupPath = Join-Path $backupRoot $migrationBackup.data.filename`. Verify with `Resolve-Path` that the result is a direct child of `$backupRoot` before reading it.

Expected: health database `ok`, backup size > 0, and `$backupPath` exists inside the validated backups directory.

- [ ] **Step 2: Export only from the retained backup**

```powershell
npm run cloud:export -- --database "$backupPath" --output "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
```

Expected: integrity `ok`, format version 1, nonempty SHA-256, and counts printed without record contents.

- [ ] **Step 3: Import through the pulled Vercel environment**

```powershell
npx vercel env run -- npm run cloud:import -- --input "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
```

Expected: idempotent upserts complete in transactions; no secret is printed.

- [ ] **Step 4: Verify counts and canonical hash**

```powershell
npx vercel env run -- npm run cloud:verify -- --input "$env:TEMP\muzi-cloud-migration-2026-08-16.json"
```

Expected: every collection/settings/review count matches and the canonical hash matches. Rerun import and verification once to prove idempotency; totals must remain unchanged.

- [ ] **Step 5: Spot-check critical records through Neon read-only queries**

Check only titles/counts for settings, current-day plan items, important dates, long-term goals, and active focus timer. Expected: values match the local API; do not expose private content in the final response.

---

### Task 10: Build and verify a protected preview deployment

**Files:**
- Modify if verification finds issues: only files already introduced by Tasks 2–6.
- Test: `tests/e2e/acceptance.spec.ts`

**Interfaces:**
- Consumes: linked resources, imported cloud data, and cloud application build.
- Produces: one protected Vercel preview deployment ready for promotion.

- [ ] **Step 1: Run local verification with cloud environment available**

```powershell
npm run verify
npx vercel build
```

Expected: lint, typecheck, Vitest, Vite build, server build, artifact test, production test, and Vercel build all pass.

- [ ] **Step 2: Deploy preview from source**

```powershell
$previewUrl = (npx vercel deploy).Trim()
```

Expected: preview URL and READY status. Save only the URL/deployment ID, never environment values.

- [ ] **Step 3: Verify protection and health**

Unauthenticated fetch must be blocked by Vercel Authentication. Use `vercel curl` or the Vercel authenticated fetch tool to verify:

```text
GET /api/health = 200
runtime = cloud
database = connected
GET /api/state = 200 and migrated collections are nonempty where expected
```

- [ ] **Step 4: Perform rendered desktop/mobile QA**

With authenticated Browser access, verify at 1440×900 and 390×844:

```text
four workbench headings visible
all four appearances operable
no horizontal overflow
no blocking console errors
cloud settings card visible
local directory/restore controls hidden
```

Save screenshots outside the repository.

- [ ] **Step 5: Prove write persistence without retaining test data**

Set `$qaTitle = "云端部署验收-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"`, create a plan item with that exact title, reload, sign out/in, and confirm it remains. Soft-delete, restore, soft-delete again, then permanently delete it. Expected: final cloud counts equal pre-test counts.

- [ ] **Step 6: Verify private Blob behavior**

Create a temporary book, upload a minimal valid test PDF and PNG cover, read both through authenticated API routes, remove both, and permanently delete the book. Expected: Blob operations succeed and no test entity/file remains.

- [ ] **Step 7: Scan preview build and runtime errors**

Use Vercel build logs and runtime errors/logs for the preview deployment. Expected: zero unresolved build/runtime errors after test traffic.

---

### Task 11: Promote to production and run final regressions

**Files:**
- Modify: `docs/deployment/vercel-hobby.md` only if the final production alias differs from the recorded project URL.

**Interfaces:**
- Consumes: the exact verified preview deployment from Task 10.
- Produces: a protected production URL and a still-working desktop application.

- [ ] **Step 1: Promote the tested artifact without rebuilding**

```powershell
npx vercel promote $previewUrl
```

Expected: production alias points to the same deployment ID that passed preview tests.

- [ ] **Step 2: Confirm production protection and persistence**

Verify unauthenticated access is blocked, authenticated `/api/health` is 200, migrated data appears, and a small create/reload/delete cycle persists. Confirm project plan remains Hobby and integrations remain Free/Hobby.

- [ ] **Step 3: Scan production observability**

Query production runtime errors and logs for the last hour after verification traffic. Expected: no unhandled errors; record any harmless cold-start latency separately.

- [ ] **Step 4: Rebuild/restart and verify the desktop application**

```powershell
$env:MUZI_NO_OPEN='1'
npm run app:start
powershell -ExecutionPolicy Bypass -File tests/windows-shortcut.test.ps1
node --test tests/app-icon-assets.test.mjs
```

Expected: local `http://127.0.0.1:4317/` still loads, local database health is `ok`, shortcut target/icon pass, and desktop data counts are unchanged from the pre-migration snapshot.

- [ ] **Step 5: Run final repository verification**

```powershell
npm run verify
git diff --check
git status --short
```

Expected: verification passes; only intentionally ignored `.vercel`, `.env.local`, migration temp data, and pre-existing `.superpowers/brainstorm` files are uncommitted.

- [ ] **Step 6: Commit final deployment documentation if changed**

```powershell
git add -- docs/deployment/vercel-hobby.md
git commit -m "docs: record production workspace deployment"
```

Skip this commit only if the documentation has no change.

- [ ] **Step 7: Final handoff**

Report:

```text
production URL
target = production
status = READY
Vercel plan = Hobby
Neon plan = Free
Blob access = private, Hobby free allowance
migration counts/hash = matched
authentication = enabled
production runtime error scan = clean
desktop regression = passed
```

Do not include any private data values or secrets.
