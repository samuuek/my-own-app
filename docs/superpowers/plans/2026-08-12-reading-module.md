# 读书模块实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“生活”分组中增加与工作台三套外观一致的读书中心，支持书架、阅读统计、多篇笔记、PDF 上传和带当前页联动的内置阅读器。

**Architecture:** 保持现有 React/Vite + Fastify + SQLite 架构，通过顺序迁移增加 `books`、`reading_sessions`、`reading_notes` 三类结构化数据。附件由独立 `ReadingFileManager` 保存在数据根目录，受控接口负责上传和读取；前端用 `pdfjs-dist` 渲染 PDF，读书首页、书籍详情和阅读视图保持同一路由模块内的清晰边界。

**Tech Stack:** React 19、React Router 7、TanStack Query、Fastify 5、better-sqlite3、Zod、PDF.js、Vitest、Testing Library、Playwright。

## Global Constraints

- 默认继续只监听 `127.0.0.1`，不扩大网络访问范围。
- PDF 为可选附件，每本书最多一个，只接受文件头为 `%PDF-` 且不超过 100 MB 的文件。
- 数据库只保存服务端生成的文件标识，不保存任意用户路径。
- 页面必须适配 liquid、notebook、neo 三套外观以及桌面和手机宽度。
- 现有用户数据库必须通过 `003_reading_module.sql` 无损升级，不修改或重建已有表。
- 书籍、进度和笔记进入搜索、回收站、导出；附件进入完整 ZIP 导出并有完整性清单。
- 不实现 EPUB/MOBI、OCR、云同步、多人账号或在线书库搜索。

---

### Task 1: 阅读数据模型与领域校验

**Files:**
- Create: `database/migrations/003_reading_module.sql`
- Create: `server/reading.ts`
- Modify: `server/collections.ts`
- Modify: `server/store.ts`
- Modify: `src/types.ts`
- Modify: `tests/integration/persistence.test.ts`
- Create: `tests/unit/reading.test.ts`

**Interfaces:**
- Produces `books`, `readingSessions`, `readingNotes` collection names and corresponding `WorkspaceState` arrays.
- Produces `validateBookProgress(currentPage: number, totalPages: number | null): void` and `calculateReadingStats(book, sessions, notes)`.
- `books` fields: `title`, `author`, `status`, `total_pages`, `current_page`, `rating`, `description`, `cover_file_id`, `cover_filename`, `pdf_file_id`, `pdf_filename`, `last_read_at`.
- `readingSessions` fields: `book_id`, `session_date`, `start_page`, `end_page`, `duration_minutes`, `notes`.
- `readingNotes` fields: `book_id`, `note_date`, `chapter`, `start_page`, `end_page`, `excerpt`, `feeling`, `thinking`.

- [ ] **Step 1: 写失败的迁移和领域测试**

```ts
it("migrates an existing database to reading tables without losing records", async () => {
  expect(versions).toEqual(["001_initial.sql", "002_workout_body_part.sql", "003_reading_module.sql"]);
  expect(tableNames).toEqual(expect.arrayContaining(["books", "reading_sessions", "reading_notes"]));
});

it("rejects a current page beyond the known total", () => {
  expect(() => validateBookProgress(301, 300)).toThrow("当前页不能超过总页数");
});
```

- [ ] **Step 2: 运行测试并确认因迁移和函数不存在而失败**

Run: `npm test -- --run tests/integration/persistence.test.ts tests/unit/reading.test.ts`
Expected: FAIL，缺少 `003_reading_module.sql` 或 `validateBookProgress`。

- [ ] **Step 3: 增加迁移、集合定义和纯函数**

```sql
CREATE TABLE books (..., deleted_at TEXT);
CREATE TABLE reading_sessions (..., book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, deleted_at TEXT);
CREATE TABLE reading_notes (..., book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE, deleted_at TEXT);
CREATE INDEX idx_reading_sessions_book_date ON reading_sessions(book_id, session_date) WHERE deleted_at IS NULL;
CREATE INDEX idx_reading_notes_book_date ON reading_notes(book_id, note_date) WHERE deleted_at IS NULL;
```

在 `AppStore` 写入前调用领域校验；书籍软删除时查询层隐藏其子记录，恢复后重新显示，永久删除依赖外键级联。

- [ ] **Step 4: 运行数据测试确认通过**

Run: `npm test -- --run tests/integration/persistence.test.ts tests/unit/reading.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交数据模型**

```bash
git add database/migrations/003_reading_module.sql server/reading.ts server/collections.ts server/store.ts src/types.ts tests/integration/persistence.test.ts tests/unit/reading.test.ts
git commit -m "feat: add reading data model"
```

### Task 2: 书籍、进度和笔记接口

**Files:**
- Modify: `server/app.ts`
- Modify: `server/reading.ts`
- Modify: `src/api.ts`
- Modify: `tests/integration/life-modules.test.ts`
- Modify: `tests/integration/cross-cutting.test.ts`

**Interfaces:**
- Produces `POST /api/books/:id/progress`, which atomically creates a reading session and updates the book.
- Adds `api.recordReadingProgress(id, input)` returning `{ book: Entity; session: Entity; stats: ReadingStats }`.
- Existing generic CRUD handles books and notes; search returns book titles plus note excerpt/feeling/thinking under module `reading`.

- [ ] **Step 1: 写失败的完整读书链路测试**

```ts
const book = await create("books", { title: "思考，快与慢", author: "丹尼尔·卡尼曼", status: "reading", total_pages: 500, current_page: 0 });
const progress = await post(`/api/books/${book.id}/progress`, { session_date: "2026-08-12", start_page: 1, end_page: 30, duration_minutes: 45, notes: "第一部分" });
expect(progress.book.current_page).toBe(30);
expect(progress.stats.pagesRead).toBe(30);
```

并增加搜索笔记、书籍软删除/恢复后子记录可见性、永久删除级联测试。

- [ ] **Step 2: 运行接口测试并确认新路由失败**

Run: `npm test -- --run tests/integration/life-modules.test.ts tests/integration/cross-cutting.test.ts`
Expected: FAIL，进度接口返回 404 或缺少 reading 集合。

- [ ] **Step 3: 实现原子进度记录与 API 客户端**

```ts
app.post("/api/books/:id/progress", async (request, reply) => {
  const input = readingProgressSchema.parse(request.body);
  return reply.code(201).send({ data: store.recordReadingProgress(id, input) });
});
```

事务内验证页码、创建 session、更新 `current_page` 和 `last_read_at`；到达总页数时返回 `suggestCompletion: true`，不自动改状态。

- [ ] **Step 4: 运行接口和搜索测试确认通过**

Run: `npm test -- --run tests/integration/life-modules.test.ts tests/integration/cross-cutting.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交接口功能**

```bash
git add server/app.ts server/reading.ts src/api.ts tests/integration/life-modules.test.ts tests/integration/cross-cutting.test.ts
git commit -m "feat: add reading progress and notes API"
```

### Task 3: 安全附件存储、备份和导出

**Files:**
- Create: `server/reading-files.ts`
- Modify: `server/config.ts`
- Modify: `server/app.ts`
- Modify: `server/backup.ts`
- Modify: `src/api.ts`
- Create: `tests/integration/reading-files.test.ts`
- Modify: `tests/integration/backup-export.test.ts`

**Interfaces:**
- Extends `AppPaths` with `readingFilesDir` and creates it on startup.
- Produces `ReadingFileManager.savePdf(bookId, stream, metadata)`, `resolvePdf(book)`, `removePdf(book)` and equivalent cover methods.
- Routes: `PUT/GET/DELETE /api/books/:id/pdf`, `PUT/GET/DELETE /api/books/:id/cover`.
- Upload requests use raw `application/pdf` or `image/png|image/jpeg|image/webp` bodies with `X-File-Name`; server-generated UUID filenames prevent path injection.

- [ ] **Step 1: 写失败的文件安全测试**

```ts
const bad = await app.inject({ method: "PUT", url: `/api/books/${id}/pdf`, headers: { "content-type": "application/pdf" }, payload: Buffer.from("not a pdf") });
expect(bad.statusCode).toBe(400);
expect(bad.json().error.message).toContain("PDF");
```

覆盖合法 `%PDF-`、100 MB 上限、替换清理旧文件、缺失文件 404、路径逃逸、删除书籍清理附件以及导出 ZIP 含 `attachments/manifest.json`。

- [ ] **Step 2: 运行文件测试并确认接口不存在**

Run: `npm test -- --run tests/integration/reading-files.test.ts tests/integration/backup-export.test.ts`
Expected: FAIL，上传接口返回 404 或 ZIP 不含附件。

- [ ] **Step 3: 实现流式限额、文件头校验和原子替换**

```ts
app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: 100 * 1024 * 1024 }, (_request, body, done) => done(null, body));
```

文件先写入专用目录的 `.partial`，通过大小和 magic bytes 校验后原子改名，再事务更新书籍；失败时删除临时文件。导出 ZIP 加入附件和 SHA-256 清单；恢复/状态接口报告缺失附件数量。

- [ ] **Step 4: 运行文件、备份和导出测试确认通过**

Run: `npm test -- --run tests/integration/reading-files.test.ts tests/integration/backup-export.test.ts`
Expected: PASS，测试结束后临时数据目录无 `.partial` 文件。

- [ ] **Step 5: 提交附件功能**

```bash
git add server/reading-files.ts server/config.ts server/app.ts server/backup.ts src/api.ts tests/integration/reading-files.test.ts tests/integration/backup-export.test.ts
git commit -m "feat: add secure reading attachments"
```

### Task 4: 读书导航、书架和书籍详情

**Files:**
- Create: `src/pages/ReadingPage.tsx`
- Create: `src/components/reading/BookForm.tsx`
- Create: `src/components/reading/ReadingStats.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/ModuleArtwork.tsx`
- Modify: `src/pages/TodayPage.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `src/styles.css`
- Modify: `src/themes/notebook.css`
- Modify: `src/neo.css`
- Create: `public/assets/module-icons/reading-v1.webp`
- Modify: `tests/components/app-shell.test.tsx`
- Create: `tests/components/reading-page.test.tsx`

**Interfaces:**
- `/reading` renders shelf; `/reading/:bookId` renders details.
- Query `?new=book` opens the book form; quick-create includes “添加书籍”.
- `ReadingStats` consumes `{ book, sessions, notes }` and displays percentage, pages, minutes, notes and last-read time.

- [ ] **Step 1: 写失败的导航与书架测试**

```tsx
expect(await screen.findByRole("link", { name: "读书" })).toHaveAttribute("href", "/reading");
expect(screen.getByText("在读 1 本")).toBeInTheDocument();
expect(screen.getByText("完成 20%")).toBeInTheDocument();
```

覆盖状态筛选、无 PDF 书籍、创建/编辑书籍、记录进度以及创建“阅读：《书名》”今日事项。

- [ ] **Step 2: 运行组件测试并确认缺少入口和页面**

Run: `npm test -- --run tests/components/app-shell.test.tsx tests/components/reading-page.test.tsx`
Expected: FAIL，找不到“读书”导航或页面。

- [ ] **Step 3: 实现页面、路由和三套主题样式**

`ReadingPage` 根据路由参数切换书架和详情；所有交互复用 `PageHeader`、`Section`、`Modal`、`EntityForm`、`Button`、`Badge`、`EmptyState`。Neo 导航总数由 9 更新为 10，读书拥有独立 tone 和模块图标。

- [ ] **Step 4: 运行组件测试确认通过**

Run: `npm test -- --run tests/components/app-shell.test.tsx tests/components/reading-page.test.tsx`
Expected: PASS。

- [ ] **Step 5: 提交书架与详情**

```bash
git add src/pages/ReadingPage.tsx src/components/reading src/App.tsx src/components/Layout.tsx src/components/ModuleArtwork.tsx src/pages/TodayPage.tsx src/pages/SettingsPage.tsx src/styles.css src/themes/notebook.css src/neo.css public/assets/module-icons/reading-v1.webp tests/components/app-shell.test.tsx tests/components/reading-page.test.tsx
git commit -m "feat: add reading shelf and book details"
```

### Task 5: PDF 阅读器与当前页笔记

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/reading/PdfReader.tsx`
- Create: `src/components/reading/ReadingNoteForm.tsx`
- Modify: `src/pages/ReadingPage.tsx`
- Modify: `src/styles.css`
- Modify: `src/themes/notebook.css`
- Modify: `src/neo.css`
- Create: `tests/components/pdf-reader.test.tsx`
- Modify: `tests/components/reading-page.test.tsx`

**Interfaces:**
- Adds `pdfjs-dist` dependency and configures its worker through Vite-compatible `new URL(..., import.meta.url)`.
- `PdfReader({ url, initialPage, onPageChange, onAddNote })` exposes previous/next, jump, zoom and current page.
- `ReadingNoteForm({ bookId, defaultPage, note?, onSaved, onCancel })` auto-populates both page fields from `defaultPage`.

- [ ] **Step 1: 安装 PDF.js 并写失败的阅读器测试**

Run: `npm install pdfjs-dist`

```tsx
render(<PdfReader url="/api/books/b1/pdf" initialPage={7} onPageChange={onPageChange} onAddNote={onAddNote} />);
await user.click(screen.getByRole("button", { name: "添加当前页笔记" }));
expect(onAddNote).toHaveBeenCalledWith(7);
```

覆盖翻页边界、跳页、缩放、加载错误、继续上次阅读和笔记默认页码。

- [ ] **Step 2: 运行阅读器测试并确认组件不存在**

Run: `npm test -- --run tests/components/pdf-reader.test.tsx tests/components/reading-page.test.tsx`
Expected: FAIL，无法导入 `PdfReader`。

- [ ] **Step 3: 实现 PDF.js 阅读器和笔记侧栏**

Canvas 渲染在 effect 中取消旧 render task，页面/缩放变更时重新绘制；移动端布局改为阅读区在上、笔记区在下。翻页仅更新书籍 `current_page` 的轻量位置，点击“记录进度”才创建 session。

- [ ] **Step 4: 运行组件测试与生产构建确认 worker 可打包**

Run: `npm test -- --run tests/components/pdf-reader.test.tsx tests/components/reading-page.test.tsx && npm run build`
Expected: PASS，构建产物包含 PDF worker 且无 worker 路径错误。

- [ ] **Step 5: 提交阅读器**

```bash
git add package.json package-lock.json src/components/reading/PdfReader.tsx src/components/reading/ReadingNoteForm.tsx src/pages/ReadingPage.tsx src/styles.css src/themes/notebook.css src/neo.css tests/components/pdf-reader.test.tsx tests/components/reading-page.test.tsx
git commit -m "feat: add PDF reading and page-linked notes"
```

### Task 6: 端到端验收、文档和完整验证

**Files:**
- Modify: `tests/e2e/acceptance.spec.ts`
- Create: `tests/fixtures/sample-reading.pdf`
- Modify: `README.md`
- Modify: `docs/ACCEPTANCE.md`
- Modify: `docs/API.md`
- Modify: `docs/DATA_MODEL.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- No new production interface; this task proves the complete user journey and documents operation/recovery semantics.

- [ ] **Step 1: 写失败的端到端读书旅程**

```ts
test("adds a book, reads a PDF, records progress and restores a deleted note", async ({ page }) => {
  await page.getByRole("link", { name: "读书" }).click();
  await page.getByRole("button", { name: "添加书籍" }).click();
  // 创建书籍、上传 fixture、翻页、记录进度、添加当前页笔记、搜索、删除与恢复。
});
```

分别切换 liquid、notebook、neo，并在 390×844 和桌面宽度断言无水平溢出、主要操作可见。

- [ ] **Step 2: 运行端到端测试并修复任何真实集成缺口**

Run: `npm run test:e2e -- --grep "adds a book"`
Expected: 初次运行若发现缺口则 FAIL；只修复测试揭示的读书流程问题，不做无关重构。

- [ ] **Step 3: 更新文档和验收映射**

README 增加读书能力；API 文档列出进度与附件端点；数据模型记录三张表；运维文档说明附件目录、100 MB 限制、备份/导出区别和迁移电脑方式。

- [ ] **Step 4: 执行完整验证**

Run: `npm run test:all`
Expected: lint、类型检查、55 项既有测试及全部新增测试、构建、artifact、production 和 Playwright 全部通过，无错误或警告。

- [ ] **Step 5: 检查工作区差异并提交验收文档**

Run: `git diff --check && git status --short`

```bash
git add tests/e2e/acceptance.spec.ts tests/fixtures/sample-reading.pdf README.md docs/ACCEPTANCE.md docs/API.md docs/DATA_MODEL.md docs/OPERATIONS.md
git commit -m "test: verify complete reading workflow"
```
