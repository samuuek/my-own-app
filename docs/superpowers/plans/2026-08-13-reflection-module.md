# Daily Reflection Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a local-first “思考” module with one structured reflection per day, multiple free-form thought notes, searchable history, and opt-in conversion of tomorrow actions into plan items.

**Architecture:** Add three SQLite-backed generic collections plus two transactional reflection commands for daily upsert and plan conversion. A dedicated React page will derive today/history views from WorkspaceContext and reuse the existing forms, cards, search, trash, export, and source-navigation patterns.

**Tech Stack:** React 19, TypeScript, Fastify, SQLite/better-sqlite3, Vitest, Testing Library, Vite.

## Global Constraints

- Each natural date has at most one active main reflection.
- Free thought notes are unlimited and require title, source category, and body.
- Source categories are exactly `work`, `life`, `reading`, `conversation`, `event`, `inspiration`, and `other`.
- Tomorrow actions create plan items only after an explicit click and cannot create duplicates while a live linked plan exists.
- All data remains local and participates in search, export, trash, backup, and the three existing visual themes.
- No AI generation, cloud sync, collaboration, emotion charts, or automatic plan creation.

---

### Task 1: Reflection domain rules and database schema

**Files:**
- Create: `database/migrations/004_reflection_module.sql`
- Create: `server/reflection.ts`
- Create: `tests/unit/reflection.test.ts`
- Modify: `tests/integration/persistence.test.ts`
- Modify: `tests/integration/health.test.ts`

**Interfaces:**
- Produces: `ReflectionValidationError`, `validateSourceCategory(value)`, `calculateReflectionCompletion(reflection)`, and `nextLocalDate(date)`.
- Produces tables `daily_reflections`, `reflection_actions`, and `thought_notes`.

- [ ] Write unit tests proving allowed/invalid categories, completion percentage, and month-boundary next-date calculation.
- [ ] Run `npx vitest run tests/unit/reflection.test.ts` and confirm failure because the domain module does not exist.
- [ ] Implement domain helpers with deterministic local-date string arithmetic and non-empty fixed-field completion counting.
- [ ] Add migration fields, foreign keys, soft-delete metadata, indexes, and a partial unique index on active `reflection_date`.
- [ ] Extend migration/health assertions to require `004_reflection_module.sql`.
- [ ] Run the focused unit and persistence tests and confirm they pass.

### Task 2: Collections, transactional commands, search, trash, and export

**Files:**
- Modify: `server/collections.ts`
- Modify: `server/store.ts`
- Modify: `server/app.ts`
- Modify: `server/search.ts`
- Modify: `src/api.ts`
- Modify: `tests/integration/life-modules.test.ts`
- Modify: `tests/integration/cross-cutting.test.ts`
- Modify: `tests/integration/backup-export.test.ts`

**Interfaces:**
- Produces collection names `dailyReflections`, `reflectionActions`, and `thoughtNotes`.
- Produces `store.saveDailyReflection(input)` and `store.addReflectionActionToPlan(actionId)`.
- Produces `PUT /api/reflections/daily` and `POST /api/reflection-actions/:id/add-to-plan`.

- [ ] Write integration tests for same-date upsert, action replacement, source validation, parent soft-delete visibility, restoration, and idempotent plan conversion.
- [ ] Add failing assertions that search returns reflection content and ZIP export includes all three CSV collections.
- [ ] Run the focused integration tests and confirm the new expectations fail.
- [ ] Register exact field allowlists and search text fields for all reflection collections.
- [ ] Implement daily save as one SQLite transaction: upsert the active main record, update/create submitted actions, and soft-delete removed actions.
- [ ] Implement plan conversion as one transaction: reuse a live linked plan or create a next-day `planItems` row with reflection source metadata and persist its ID.
- [ ] Add Fastify routes and typed client methods, then run the focused integration tests until green.

### Task 3: Workspace state and reflection page

**Files:**
- Create: `src/pages/ReflectionPage.tsx`
- Create: `tests/components/reflection-page.test.tsx`
- Modify: `src/types.ts`
- Modify: `src/WorkspaceContext.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `api.saveDailyReflection(input)` and `api.addReflectionActionToPlan(id)`.
- Produces routes `/reflection` and `/reflection/:date`.

- [ ] Write component tests for today's empty draft, editing all fixed sections, adding/removing tomorrow actions, creating multiple free notes, history source/keyword filtering, and linked-plan status.
- [ ] Run `npx vitest run tests/components/reflection-page.test.tsx` and confirm failure because the page is absent.
- [ ] Add the three collection arrays to workspace types/default state.
- [ ] Build a focused page with `ReflectionEditor`, `TomorrowActions`, `ThoughtNotes`, and `ReflectionHistory` components; use existing `PageHeader`, `Section`, `Modal`, `EntityForm`, and operation runner.
- [ ] Add responsive styles for the reflection form, action list, notes, and history without changing other modules.
- [ ] Run the component tests, typecheck, and lint until green.

### Task 4: Workbench integration

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/ModuleArtwork.tsx`
- Create: `public/assets/module-icons/reflection-v1.svg`
- Modify: `src/pages/TodayPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/neo.css`
- Modify: `tests/components/app-shell.test.tsx`
- Modify: `tests/components/module-artwork.test.tsx`

**Interfaces:**
- Produces navigation label `思考`, quick-create entry `记录思考`, and plan-source return route `/reflection`.

- [ ] Extend shell tests to expect the “思考” link in the Life group, quick creation, source labels, artwork, and trash labels.
- [ ] Run the focused shell tests and confirm they fail.
- [ ] Add navigation/route metadata, search collection routing, module label, quick-create entry, local SVG artwork, and theme accents.
- [ ] Update Today and Settings source/collection maps.
- [ ] Run focused shell and artwork tests until green.

### Task 5: Documentation and full local verification

**Files:**
- Modify: `README.md`
- Modify: `docs/API.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Documents the new local data, endpoints, exports, and navigation behavior.

- [ ] Document the reflection module, its three collections, two command endpoints, local persistence, export, and restore behavior.
- [ ] Run `npm run verify` and require lint, typecheck, 0 failed tests, successful production build, artifact test, and production server tests.
- [ ] Start/reuse the local production app and inspect `/reflection` plus the editor dialog in the in-app browser; require no console errors or warnings.
- [ ] Review `git diff --check` and `git status --short` so the final commit includes both the previously completed reading module and this reflection module without runtime data.

### Task 6: Save locally and publish to the requested GitHub repository

**Files:**
- Modify repository-local Git configuration and remote metadata only; do not modify application files.

**Interfaces:**
- Produces a local commit on `main` and pushes it to `https://github.com/samuuek/my-own-app.git`.

- [ ] Read the most recent repository author identity and reuse it when valid; otherwise request the user's Git name/email before committing.
- [ ] Confirm the target repository is reachable and inspect its default branch before changing `origin`.
- [ ] Commit the full verified local work with a message covering the Samuel rename, reading module, and reflection module.
- [ ] Change `origin` to `https://github.com/samuuek/my-own-app.git` only after local verification and show the old/new remote in the handoff.
- [ ] Fetch the target branch without force, compare histories, and stop for user direction if a non-fast-forward or unrelated-history merge would be required.
- [ ] Push `main` normally, never force-push, and report the resulting commit hash and repository link.
