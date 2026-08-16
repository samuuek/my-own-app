# AI 周报与多模型交叉验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为思屿增加一个可核验的最近 7 天 AI 官方消息页，并支持将同一材料交给 DeepSeek、通义千问和 Kimi 免费网页版分析后进行确定性交叉对照。

**Architecture:** Node 本地服务从显式 HTTPS 白名单抓取官方发布页，规范化后写入 SQLite 缓存，并通过 `/api/weekly` 与 `/api/weekly/refresh` 提供数据。React 周报页读取缓存、筛选时间线，并复用网页往返思想实现三个模型的复制、打开、粘贴和本地保存；对照模块只依据固定 Markdown 章节和消息编号生成共识、分歧与待核实结果。

**Tech Stack:** React、TypeScript、Vite、Node HTTP、Node SQLite、原生 Fetch、Vitest、Testing Library、浏览器 Clipboard API。

## Global Constraints

- 官方事实仅来自显式白名单中的 HTTPS 官方页面，首版入口使用 [OpenAI News](https://openai.com/news/)、[Anthropic Newsroom](https://www.anthropic.com/news)、[Google DeepMind News](https://deepmind.google/discover/blog/)、[Microsoft Official Blog](https://blogs.microsoft.com/)、[Meta AI Blog](https://ai.meta.com/blog/) 与 [Hugging Face Blog](https://huggingface.co/blog)。
- 抓取后的最终 URL 域名必须仍属于对应白名单；响应上限 `2_000_000` 字节，单来源超时 `10_000` 毫秒。
- 只保留当前时间向前 7 个完整自然日内的条目；未来日期丢弃。
- 缓存新鲜期固定为 6 小时；页面打开不主动访问外网，只有用户点击刷新才抓取。
- 单来源失败保留其旧缓存并返回来源错误；不得清空其他来源的成功结果。
- 三个模型必须接收相同排序、相同内容、相同材料指纹的公开消息，不包含用户议题、知识库、旁注或历史对话。
- 模型账号、密码、Cookie、Token 和登录状态不得被读取或保存。
- 模型多数票不得标记为官方事实；无消息编号的观点归入“待核实”。
- 模型导入回答上限 `200_000` 字符。
- 沿用现有低饱和蓝绿色、开放列表和 `760px` 移动端断点，不增加 UI 依赖。

---

## File Structure

- Create `server/weekly-sources.mjs`: 官方来源注册表、白名单 URL 校验、HTML/RSS 条目解析入口。
- Create `server/weekly-sources.test.mjs`: 来源解析、7 天过滤、去重、安全约束测试。
- Modify `server/database.mjs`: 周报消息、来源状态与模型分析持久化。
- Modify `server/database.test.mjs`: 缓存更新、失败保留和分析版本测试。
- Modify `server/http.mjs`: `/api/weekly`、`/api/weekly/refresh`、分析保存 API。
- Modify `server/api.test.mjs`: 周报路由和部分失败测试。
- Create `src/features/weekly/weekly-api.ts`: 周报前端类型与 API 客户端。
- Create `src/features/weekly/weekly-handoff.ts`: 三个网页版模型注册表、统一提示词、材料指纹和 Markdown 解析。
- Create `src/features/weekly/weekly-handoff.test.ts`: 提示词一致性与交叉验证规则测试。
- Create `src/features/weekly/WeeklyView.tsx`: 周报页、筛选、刷新状态、三个分析槽位与对照结果。
- Create `src/features/weekly/WeeklyView.test.tsx`: 页面主流程和失败降级测试。
- Modify `src/app/App.tsx`: 新导航与 `#weekly` 路由。
- Modify `src/app/App.test.tsx`: 导航与刷新恢复测试。
- Modify `src/styles/global.css`: 周报桌面和移动端样式。
- Modify `docs/verification/2026-08-13-mvp-fidelity.md`: 浏览器验收记录。

---

### Task 1: 官方来源规范化与安全抓取

**Files:**
- Create: `server/weekly-sources.mjs`
- Create: `server/weekly-sources.test.mjs`

**Interfaces:**
- Produces: `WEEKLY_SOURCES: Array<{ id; organization; url; allowedHosts; category }>`。
- Produces: `normalizeWeeklyItems(source, entries, now): WeeklyItem[]`。
- Produces: `fetchWeeklySource(source, { fetcher, now, timeoutMs, maxBytes }): Promise<WeeklyItem[]>`。

- [ ] **Step 1: 写日期边界、去重和未来日期的失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWeeklyItems } from './weekly-sources.mjs'

test('normalizes only the last seven days and deduplicates canonical URLs', () => {
  const source = { id: 'openai', organization: 'OpenAI', url: 'https://openai.com/news/', allowedHosts: ['openai.com'], category: '产品' }
  const entries = [
    { title: 'A', url: 'https://openai.com/index/a/?utm_source=x', publishedAt: '2026-08-15T03:00:00Z', summary: 'one' },
    { title: 'A copy', url: 'https://openai.com/index/a/', publishedAt: '2026-08-15T03:00:00Z', summary: 'two' },
    { title: 'old', url: 'https://openai.com/index/old/', publishedAt: '2026-08-07T00:00:00Z', summary: '' },
    { title: 'future', url: 'https://openai.com/index/future/', publishedAt: '2026-08-17T00:00:00Z', summary: '' },
  ]
  const result = normalizeWeeklyItems(source, entries, new Date('2026-08-16T12:00:00+08:00'))
  assert.equal(result.length, 1)
  assert.equal(result[0].url, 'https://openai.com/index/a/')
  assert.equal(result[0].organization, 'OpenAI')
})
```

- [ ] **Step 2: 运行测试并确认模块缺失失败**

Run: `node --test server/weekly-sources.test.mjs`

Expected: FAIL，提示找不到 `weekly-sources.mjs`。

- [ ] **Step 3: 实现来源注册表与规范化函数**

注册六个已核验入口 URL；`canonicalUrl()` 删除 hash、`utm_*`、`ref`、`source` 查询参数并保留其他功能参数。`normalizeWeeklyItems()` 验证标题、日期、HTTPS 和最终 hostname，生成 `sha256(canonicalUrl)` 作为 ID，并按 `publishedAt` 降序返回。

- [ ] **Step 4: 写安全抓取失败测试**

```js
test('rejects redirects outside the source allowlist and oversized responses', async () => {
  const source = { id: 'openai', organization: 'OpenAI', url: 'https://openai.com/news/', allowedHosts: ['openai.com'], category: '产品' }
  await assert.rejects(() => fetchWeeklySource(source, { fetcher: async () => ({ ok: true, url: 'https://evil.example/feed', headers: new Headers(), text: async () => '<html></html>' }) }), /来源域名不受信任/)
  await assert.rejects(() => fetchWeeklySource(source, { maxBytes: 5, fetcher: async () => ({ ok: true, url: source.url, headers: new Headers({ 'content-length': '10' }), text: async () => '0123456789' }) }), /响应内容过大/)
})
```

- [ ] **Step 5: 实现抓取器与最小解析器**

`fetchWeeklySource()` 使用 `AbortSignal.timeout(10_000)`，先检查 `content-length`，读取文本后再次检查字符长度；根据 `content-type` 或正文起始内容选择 RSS/Atom 或 HTML 解析。首版解析器提取标准 `<item>`、`<entry>`、JSON-LD `BlogPosting/NewsArticle` 和页面内 `<article>` 的标题、链接、日期与描述；解析不到条目时抛出“来源格式未识别”。

- [ ] **Step 6: 运行测试并提交**

Run: `node --test server/weekly-sources.test.mjs`

Expected: PASS。

```bash
git add server/weekly-sources.mjs server/weekly-sources.test.mjs
git commit -m "feat: add safe weekly AI source fetcher"
```

---

### Task 2: SQLite 周报缓存与模型分析版本

**Files:**
- Modify: `server/database.mjs`
- Modify: `server/database.test.mjs`

**Interfaces:**
- Consumes: `WeeklyItem` 规范字段。
- Produces: `store.getWeeklySnapshot(now)`。
- Produces: `store.replaceWeeklySource(sourceId, items, refreshedAt)`。
- Produces: `store.markWeeklySourceError(sourceId, message, attemptedAt)`。
- Produces: `store.saveWeeklyAnalysis(input)`、`store.listWeeklyAnalyses(fingerprint)`。

- [ ] **Step 1: 写缓存替换与失败保留测试**

```js
test('weekly source refresh replaces only that source and errors preserve cached items', () => {
  const store = createDatabase(':memory:', { seed: false })
  store.replaceWeeklySource('openai', [{ id: 'a', sourceId: 'openai', organization: 'OpenAI', title: 'A', url: 'https://openai.com/a', publishedAt: '2026-08-15T00:00:00Z', category: '产品', summary: 's', significance: '' }], '2026-08-16T00:00:00Z')
  store.replaceWeeklySource('meta', [{ id: 'b', sourceId: 'meta', organization: 'Meta AI', title: 'B', url: 'https://ai.meta.com/blog/b', publishedAt: '2026-08-15T00:00:00Z', category: '研究', summary: 's', significance: '' }], '2026-08-16T00:00:00Z')
  store.markWeeklySourceError('openai', 'timeout', '2026-08-16T01:00:00Z')
  const snapshot = store.getWeeklySnapshot(new Date('2026-08-16T02:00:00Z'))
  assert.deepEqual(snapshot.items.map(item => item.id).sort(), ['a', 'b'])
  assert.equal(snapshot.sources.find(source => source.id === 'openai').error, 'timeout')
  store.close()
})
```

- [ ] **Step 2: 运行测试确认接口不存在**

Run: `node --test server/database.test.mjs`

Expected: FAIL，提示 `replaceWeeklySource is not a function`。

- [ ] **Step 3: 增加表与事务方法**

新增 `weekly_items`、`weekly_source_status`、`weekly_analyses`。`replaceWeeklySource()` 使用事务只删除并重建指定 `source_id`；`markWeeklySourceError()` 只更新状态表。`getWeeklySnapshot()` 返回 7 天内条目、各来源最后成功/尝试时间、错误和 `stale`（最新成功时间距 `now` 超过 6 小时）。

- [ ] **Step 4: 写材料指纹隔离测试并实现分析方法**

测试保存两种 fingerprint 后，`listWeeklyAnalyses('v2')` 只返回 v2。分析唯一键为 `(analyst_id, fingerprint)`，重复保存覆盖同模型同版本的旧文本但保留新的 `updated_at`。

- [ ] **Step 5: 运行数据库测试并提交**

Run: `node --test server/database.test.mjs`

Expected: PASS。

```bash
git add server/database.mjs server/database.test.mjs
git commit -m "feat: persist weekly news and analyses"
```

---

### Task 3: 周报 HTTP API 与部分失败刷新

**Files:**
- Modify: `server/http.mjs`
- Modify: `server/api.test.mjs`

**Interfaces:**
- Consumes: `WEEKLY_SOURCES`、`fetchWeeklySource()` 与 Task 2 store 方法。
- Produces: `GET /api/weekly`、`POST /api/weekly/refresh`、`POST /api/weekly/analyses`。

- [ ] **Step 1: 写 GET 与部分失败刷新测试**

为 `createApiServer` 增加可选 `weeklySources` 和 `weeklyFetcher` 注入。测试两个来源中一个成功、一个抛错后，响应为 200、成功条目已缓存、失败来源包含错误且旧缓存仍存在。

- [ ] **Step 2: 运行 API 测试确认 404**

Run: `node --test server/api.test.mjs`

Expected: FAIL，`/api/weekly` 返回 404。

- [ ] **Step 3: 实现三个路由与输入验证**

`GET /api/weekly` 返回 `{ ...snapshot, analyses }`；refresh 用 `Promise.allSettled` 并逐来源调用 replace/error；分析保存只允许 `deepseek-web`、`qwen-web`、`kimi-web`，要求 fingerprint、Markdown 非空且不超过 200,000 字。

- [ ] **Step 4: 运行服务端完整测试并提交**

Run: `node --test server/*.test.mjs`

Expected: PASS。

```bash
git add server/http.mjs server/api.test.mjs
git commit -m "feat: expose weekly AI news API"
```

---

### Task 4: 统一提示词、材料指纹与交叉验证解析

**Files:**
- Create: `src/features/weekly/weekly-handoff.ts`
- Create: `src/features/weekly/weekly-handoff.test.ts`
- Create: `src/features/weekly/weekly-api.ts`

**Interfaces:**
- Produces: `WEEKLY_ANALYSTS`，包含三个 ID、名称和官网 URL。
- Produces: `buildWeeklyMaterial(items): { fingerprint: string; prompt: string }`。
- Produces: `parseWeeklyAnalysis(markdown): ParsedAnalysis`。
- Produces: `compareWeeklyAnalyses(analyses): WeeklyComparison`。
- Produces: `fetchWeekly()`、`refreshWeekly()`、`saveWeeklyAnalysis()`。

- [ ] **Step 1: 写三模型同材料与稳定指纹失败测试**

```ts
test('builds one stable material prompt independent of input order', async () => {
  const first = await buildWeeklyMaterial([itemB, itemA])
  const second = await buildWeeklyMaterial([itemA, itemB])
  expect(first.fingerprint).toBe(second.fingerprint)
  expect(first.prompt).toBe(second.prompt)
  expect(first.prompt).toContain('[AI-001]')
  expect(first.prompt).toContain('只分析以下官方材料')
})
```

- [ ] **Step 2: 运行测试确认模块缺失**

Run: `npx vitest run src/features/weekly/weekly-handoff.test.ts`

Expected: FAIL，无法解析模块。

- [ ] **Step 3: 实现模型注册表、排序、编号和 SHA-256 指纹**

使用 `crypto.subtle.digest('SHA-256', TextEncoder)`；先按 `publishedAt DESC, url ASC` 排序，再生成包含编号、机构、日期、标题、摘要和 URL 的规范字符串。三个模型按钮只复用该函数的同一个结果，不接受模型专属附加材料。

- [ ] **Step 4: 写交叉规则失败测试并实现解析器**

构造 DeepSeek 将 `AI-001` 放入关键进展、千问将其放入关键进展、Kimi 将其放入可能被高估；断言 comparison 同时包含 `consensus` 与 `disagreements`，无编号行进入 `unverified`。解析器识别五个固定 `##` 标题和 `AI-\d{3}`，无法识别章节时返回 `{ status: 'unrecognized', raw }`。

- [ ] **Step 5: 实现 API 客户端并运行测试**

`weekly-api.ts` 定义与后端一致的 `WeeklyItem`、`WeeklySnapshot`、`WeeklyAnalysis`，沿用 `backend-api.ts` 的 JSON 错误读取方式。

Run: `npx vitest run src/features/weekly/weekly-handoff.test.ts && npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交前端领域逻辑**

```bash
git add src/features/weekly/weekly-api.ts src/features/weekly/weekly-handoff.ts src/features/weekly/weekly-handoff.test.ts
git commit -m "feat: add weekly analysis comparison logic"
```

---

### Task 5: AI 周报页面与导航

**Files:**
- Create: `src/features/weekly/WeeklyView.tsx`
- Create: `src/features/weekly/WeeklyView.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: Task 4 API、handoff 和 comparison 接口。
- Produces: `#weekly` 页面、分类筛选、刷新、模型槽位、导入预览和对照结果。

- [ ] **Step 1: 写导航与空状态失败测试**

```ts
test('opens the weekly AI page and restores it from the hash', async () => {
  window.history.replaceState(null, '', '#weekly')
  render(<App />)
  expect(await screen.findByRole('heading', { name: '这一周，AI 又向前走了哪里？' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'AI 周报' })).toHaveAttribute('aria-current', 'page')
})
```

- [ ] **Step 2: 运行测试确认路由未实现**

Run: `npx vitest run src/app/App.test.tsx -t "weekly AI"`

Expected: FAIL，hash 回退到今日页。

- [ ] **Step 3: 实现导航、数据加载和消息时间线**

新增 `View = ... | 'weekly'`、`Newspaper` 导航图标和 `<WeeklyView />`。页面首次无缓存显示“获取本周消息”；有缓存显示周期、更新时间、失败来源、最多三条关键进展和开放时间线。筛选按钮使用真实条目计数，原文链接使用 `target="_blank" rel="noreferrer"`。

- [ ] **Step 4: 写刷新和失败保留测试并实现**

测试点击“刷新官方消息”调用 POST；失败响应时旧条目仍可见且 alert 显示错误。按钮请求中禁用并显示“正在刷新…”，完成后恢复。

- [ ] **Step 5: 写网页往返失败测试并实现三个分析槽位**

对每个 analyst 测试：点击后写入相同 prompt、打开正确官网、显示等待导入；剪贴板读取失败打开手动粘贴框；保存成功显示“已导入”。弹窗拦截时显示普通官网链接。导入前重新比较 snapshot fingerprint，变化时阻止保存并提示重新生成材料。

- [ ] **Step 6: 实现交叉对照区**

少于两个同 fingerprint 的可识别分析时显示“再导入一个模型即可形成对照”；达到两个后展示三模型共识、共识、分歧、单模型观察和待核实列表。每项显示关联消息编号与“查看原始分析”。旧 fingerprint 分组显示“基于上一版材料”。

- [ ] **Step 7: 实现响应式样式**

新增 `.weekly-view`、`.weekly-lead`、`.weekly-timeline`、`.weekly-item`、`.analyst-slots`、`.comparison-section` 和导入对话框变体。桌面保持开放列表，不使用卡片网格堆砌；移动端改为单列，导航可横向滚动，页面自身不得产生水平溢出。

- [ ] **Step 8: 运行前端测试、类型检查并提交**

Run: `npx vitest run src/app/App.test.tsx src/features/weekly/WeeklyView.test.tsx src/features/weekly/weekly-handoff.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

```bash
git add src/app/App.tsx src/app/App.test.tsx src/features/weekly/WeeklyView.tsx src/features/weekly/WeeklyView.test.tsx src/styles/global.css
git commit -m "feat: add AI weekly cross-validation page"
```

---

### Task 6: 完整验证与浏览器验收

**Files:**
- Modify: `docs/verification/2026-08-13-mvp-fidelity.md`

**Interfaces:**
- Consumes: 完整周报功能。
- Produces: 自动化与浏览器验收记录。

- [ ] **Step 1: 运行完整自动化验证**

Run: `npm test`

Expected: 所有 Vitest 和 Node 测试 PASS。

Run: `npm run typecheck`

Expected: PASS。

Run: `npm run build`

Expected: PASS。

- [ ] **Step 2: 验证桌面主路径**

启动本地应用，进入 `#weekly`，执行获取或刷新，验证统计周期、更新时间、来源错误、分类筛选与原文链接。完成任一模型的复制、打开、回答预览和取消；使用测试夹具导入至少两个同 fingerprint 分析并检查对照区。

- [ ] **Step 3: 验证失败与版本状态**

用测试注入模拟单来源失败、全部来源失败、旧缓存、剪贴板拒绝、弹窗拦截、格式未识别和材料 fingerprint 变化；确认旧数据不丢失且提示准确。

- [ ] **Step 4: 验证移动端与控制台**

在 `390 × 844` 检查顶栏、页首、筛选、时间线、三个模型槽位和对照区；确认 `scrollWidth === clientWidth`，控制台 error/warn 为 0。

- [ ] **Step 5: 更新验证记录并提交**

在验证文档追加日期、URL、桌面与移动视口、自动化结果、来源成功/失败状态、模型往返结果、对照规则结果、控制台结果和有意限制。

```bash
git add docs/verification/2026-08-13-mvp-fidelity.md
git commit -m "docs: verify AI weekly cross-validation"
```
