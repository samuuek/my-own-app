# DeepSeek 免费网页版往返 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从思屿复制带上下文的问题并打开 DeepSeek 官网，再将复制的回答预览、编辑并保存回当前议题，无需 API Key。

**Architecture:** 在前端模型注册表中加入静态可用的 `web-handoff` 服务，并用独立纯函数负责提示词整理和回答校验。`WorkspaceView` 根据服务种类分流：API 模型继续调用本地网关，DeepSeek 网页版则写入剪贴板、打开官网、维护临时等待状态，并通过现有 `addMessage` 接口保存用户确认的回答。

**Tech Stack:** React、TypeScript、Vite、Vitest、Testing Library、浏览器 Clipboard API、现有本地消息 API。

## Global Constraints

- DeepSeek 网页地址固定使用 `https://chat.deepseek.com/`。
- 不读取或保存 DeepSeek 账号、密码、Cookie、Token 或登录状态。
- 不注入脚本、不抓取网页、不自动填写或提交 DeepSeek 输入框。
- 仅在用户明确点击时读写剪贴板；导入前必须提供可编辑预览并由用户确认。
- 提示词只携带议题标题、最近 10 条非空对话和本次问题；私人旁注、资料、纪要和导图不得自动加入。
- 单条导入回答不得为空且不得超过后端限制 `200_000` 个字符。
- 等待回答状态只保存在当前组件会话中，刷新后不恢复。
- 现有演示模型与 API 模型的站内发送流程必须保持可用。
- 沿用现有低饱和蓝绿色、开放面板、细边框和移动端断点，不增加新依赖。

---

## File Structure

- Create `src/features/models/web-handoff.ts`: DeepSeek URL、提示词生成、回答校验和剪贴板错误归一化。
- Create `src/features/models/web-handoff.test.ts`: 上述纯逻辑的单元测试。
- Modify `src/features/models/model-api.ts`: 为模型增加明确的服务种类并注册免费网页版。
- Modify `src/features/models/ModelSettings.tsx`: 将设置抽屉改成“对话服务”，免费网页版优先，API 配置折叠。
- Modify `src/features/workspace/WorkspaceView.tsx`: 实现网页往返、等待状态、导入预览和手动粘贴降级。
- Modify `src/app/App.tsx`: 更新设置入口的可访问名称和显示文案。
- Modify `src/app/App.test.tsx`: 覆盖服务抽屉与完整网页往返交互。
- Modify `src/styles/global.css`: 增加服务卡、等待状态和导入对话框的响应式样式。
- Modify `docs/verification/2026-08-13-mvp-fidelity.md`: 记录桌面、移动端和降级流程验证结果。

---

### Task 1: 网页往返领域模型与提示词整理

**Files:**
- Create: `src/features/models/web-handoff.ts`
- Create: `src/features/models/web-handoff.test.ts`
- Modify: `src/features/models/model-api.ts`

**Interfaces:**
- Produces: `ModelKind = 'demo' | 'api' | 'web-handoff'`。
- Produces: `ModelInfo.kind: ModelKind`。
- Produces: `DEEPSEEK_WEB_ID = 'deepseek-web'`、`DEEPSEEK_WEB_URL = 'https://chat.deepseek.com/'`。
- Produces: `buildWebPrompt(input: { topicTitle: string; messages: ChatMessage[]; question: string }): string`。
- Produces: `validateImportedAnswer(value: string): { ok: true; value: string } | { ok: false; error: string }`。

- [ ] **Step 1: 写提示词与回答校验的失败测试**

```ts
import { describe, expect, test } from 'vitest'
import { buildWebPrompt, DEEPSEEK_WEB_URL, validateImportedAnswer } from './web-handoff'

describe('DeepSeek 网页往返', () => {
  test('只带议题、最近十条消息和本次问题', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `历史 ${index + 1}`,
    }))
    const prompt = buildWebPrompt({ topicTitle: '是否继续追求确定性？', messages, question: '请挑战我的判断' })
    expect(prompt).not.toContain('历史 1')
    expect(prompt).not.toContain('历史 2')
    expect(prompt).toContain('历史 3')
    expect(prompt).toContain('历史 12')
    expect(prompt.match(/请挑战我的判断/g)).toHaveLength(1)
    expect(prompt).toContain('是否继续追求确定性？')
  })

  test('拒绝空回答和超过本地消息上限的回答', () => {
    expect(validateImportedAnswer('  ')).toEqual({ ok: false, error: '请先粘贴 DeepSeek 的回答' })
    expect(validateImportedAnswer('a'.repeat(200_001))).toEqual({ ok: false, error: '回答不能超过 200000 个字' })
    expect(validateImportedAnswer('  可保存  ')).toEqual({ ok: true, value: '可保存' })
    expect(DEEPSEEK_WEB_URL).toBe('https://chat.deepseek.com/')
  })
})
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npx vitest run src/features/models/web-handoff.test.ts`

Expected: FAIL，提示无法解析 `./web-handoff`。

- [ ] **Step 3: 实现网页往返纯逻辑**

```ts
export const DEEPSEEK_WEB_ID = 'deepseek-web'
export const DEEPSEEK_WEB_URL = 'https://chat.deepseek.com/'
export const MAX_IMPORTED_ANSWER_LENGTH = 200_000

export type ChatMessage = { role: 'user' | 'assistant'; content: string }

export function buildWebPrompt({ topicTitle, messages, question }: { topicTitle: string; messages: ChatMessage[]; question: string }) {
  const history = messages.filter(message => message.content.trim()).slice(-10)
  const lines = history.map(message => `${message.role === 'user' ? '我' : '对话助手'}：${message.content.trim()}`)
  return [`议题：${topicTitle.trim()}`, '', '此前对话：', ...lines, '', `我的新问题：${question.trim()}`, '', '请直接回应这个问题，并指出我可能忽略的前提或反例。'].join('\n')
}

export function validateImportedAnswer(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false as const, error: '请先粘贴 DeepSeek 的回答' }
  if (trimmed.length > MAX_IMPORTED_ANSWER_LENGTH) return { ok: false as const, error: '回答不能超过 200000 个字' }
  return { ok: true as const, value: trimmed }
}
```

- [ ] **Step 4: 给模型注册表增加服务种类与 DeepSeek 网页版**

将 `ModelInfo` 改为：

```ts
export type ModelKind = 'demo' | 'api' | 'web-handoff'
export type ModelInfo = { id: string; name: string; provider: string; available: boolean; kind: ModelKind; demo?: boolean }
```

在 `fallbackModels` 首位加入：

```ts
{ id: DEEPSEEK_WEB_ID, name: '免费网页版', provider: 'DeepSeek', available: true, kind: 'web-handoff' }
```

将演示模型标记为 `kind: 'demo', demo: true`，其余模型标记为 `kind: 'api'`；`fetchModels()` 对后端返回结果补充 `kind`，避免修改后端公开接口。暂时保留 `demo` 兼容字段，保证本任务结束时现有消费方仍能通过类型检查；Task 3 改为读取 `kind` 后再删除兼容判断。

- [ ] **Step 5: 运行单元测试、类型检查和现有测试**

Run: `npx vitest run src/features/models/web-handoff.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 6: 提交领域模型**

```bash
git add src/features/models/web-handoff.ts src/features/models/web-handoff.test.ts src/features/models/model-api.ts
git commit -m "feat: add DeepSeek web handoff model"
```

---

### Task 2: 对话服务设置抽屉

**Files:**
- Modify: `src/features/models/ModelSettings.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `ModelInfo.kind`、`DEEPSEEK_WEB_ID`。
- Produces: 标题为“对话服务”的设置抽屉、免费网页版主服务区和 `<details>` API 高级配置区。

- [ ] **Step 1: 将原设置测试改成新设计并确认失败**

```ts
test('opens conversation services with free DeepSeek first and API settings collapsed', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '对话服务' }))
  expect(screen.getByRole('heading', { name: '对话服务' })).toBeInTheDocument()
  expect(screen.getByText('登录自己的账号即可免费使用')).toBeInTheDocument()
  expect(screen.getByText('网页版可用')).toBeInTheDocument()
  expect(screen.queryByText('已连接')).not.toBeInTheDocument()
  expect(screen.getByText('API 高级配置').closest('details')).not.toHaveAttribute('open')
  expect(screen.getByText(/不会获取 DeepSeek 账号、密码或登录状态/)).toBeInTheDocument()
})
```

Run: `npx vitest run src/app/App.test.tsx -t "conversation services"`

Expected: FAIL，仍显示“模型与 API”。

- [ ] **Step 2: 重构 `ModelSettings` 的语义结构**

将组件主体组织为：

```tsx
const webModel = models.find(model => model.kind === 'web-handoff')
const apiModels = models.filter(model => model.kind === 'api')

<header>...<h2 id="model-settings-title">对话服务</h2>...</header>
<p className="settings-intro">选择获得对话反馈的方式。免费网页版不需要 API Key。</p>
{webModel && <article className="web-service-card">
  <div className="provider-icon"><ExternalLink size={18} /></div>
  <div><h3>DeepSeek 免费网页版</h3><p>登录自己的账号即可免费使用</p></div>
  <span className="ready"><CheckCircle2 size={14} />网页版可用</span>
</article>}
<p className="privacy-note"><ShieldCheck size={16} />思屿不会获取 DeepSeek 账号、密码或登录状态。</p>
<details className="api-settings">
  <summary>API 高级配置</summary>
  <div className="provider-list">{apiModels.map(model => <article key={model.id}>
    <div className="provider-icon"><Server size={18} /></div>
    <div><h3>{model.provider}</h3><p>{model.name}</p></div>
    <span className={model.available ? 'ready' : 'pending'}>{model.available ? <><CheckCircle2 size={14} />已连接</> : <><KeyRound size={14} />待配置</>}</span>
  </article>)}</div>
  <div className="settings-help"><b>配置方法</b><p>复制项目中的 <code>.env.example</code> 为 <code>.env.local</code>，填入对应 API Key、Base URL 和模型名称，然后重新启动网站。</p></div>
</details>
```

删除抽屉内演示模型展示；它仍保留在对话模型选择器中。

- [ ] **Step 3: 更新入口文案与抽屉样式**

在 `App.tsx` 将按钮改为 `aria-label="对话服务"`，可见文字改为“服务”。在 `global.css` 增加 `.web-service-card`、`.privacy-note`、`.api-settings summary` 样式，复用现有颜色变量；移动端让状态文字换到第二行，不产生水平滚动。

- [ ] **Step 4: 运行设置测试与完整前端测试**

Run: `npx vitest run src/app/App.test.tsx`

Expected: PASS，包括原导航测试和新设置测试。

Run: `npm run typecheck`

Expected: PASS。

- [ ] **Step 5: 提交对话服务抽屉**

```bash
git add src/features/models/ModelSettings.tsx src/app/App.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "feat: present free conversation service"
```

---

### Task 3: 复制问题、打开官网与等待状态

**Files:**
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `buildWebPrompt()`、`DEEPSEEK_WEB_ID`、`DEEPSEEK_WEB_URL`、`ModelInfo.kind`。
- Produces: `handoffPrompt: string` 临时状态、`openWebHandoff(question: string): Promise<void>`、等待回答操作条。

- [ ] **Step 1: 写复制、打开和等待状态的失败测试**

在测试文件的 `beforeEach` 中为本地 API 响应提供现有测试夹具，并加入：

```ts
test('copies the prompt, opens DeepSeek, and waits for the answer', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText, readText: vi.fn() } })
  const open = vi.spyOn(window, 'open').mockReturnValue({} as Window)
  const user = userEvent.setup()
  render(<App />)
  await openFirstTopic(user)
  await user.selectOptions(screen.getByLabelText('选择对话模型'), 'deepseek-web')
  await user.type(screen.getByLabelText('对话内容'), '请反驳我的结论')
  await user.click(screen.getByRole('button', { name: '打开并提问' }))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('请反驳我的结论'))
  expect(open).toHaveBeenCalledWith('https://chat.deepseek.com/', '_blank', 'noopener,noreferrer')
  expect(screen.getByText('问题已复制。获得回答后，回到这里继续。')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '再次复制问题' })).toBeInTheDocument()
})
```

Run: `npx vitest run src/app/App.test.tsx -t "copies the prompt"`

Expected: FAIL，当前发送仍调用 `/api/chat`。

- [ ] **Step 2: 在发送函数中按服务种类分流**

在 `WorkspaceView` 中计算：

```ts
const selectedModel = models.find(model => model.id === fields.selectedModel)
const isWebHandoff = selectedModel?.kind === 'web-handoff'
```

当 `isWebHandoff` 时，不立即保存用户消息，也不调用 `sendChat`；生成并保存 `handoffPrompt`，先执行 `navigator.clipboard.writeText(prompt)`，再调用 `window.open(DEEPSEEK_WEB_URL, '_blank', 'noopener,noreferrer')`。弹窗被拦截时保留提示词并显示普通的官网链接；复制失败时展示包含完整提示词的手动复制框。

- [ ] **Step 3: 增加等待状态和再次复制操作**

在消息列表和 composer 之间渲染：

```tsx
{handoffPrompt && <section className="handoff-status" aria-label="等待 DeepSeek 回答">
  <p>问题已复制。获得回答后，回到这里继续。</p>
  <div>
    <button className="primary" onClick={beginImport}>粘贴 DeepSeek 回答</button>
    <button className="text-button" onClick={copyHandoffPrompt}>再次复制问题</button>
  </div>
</section>}
```

免费网页版选中时发送按钮使用 `aria-label="打开并提问"`，辅助文字改为“Enter 打开并提问 · Shift + Enter 换行”；API 与演示模型继续显示原发送文案。

- [ ] **Step 4: 添加等待状态、手动复制和弹窗拦截样式**

使用 `.handoff-status`、`.handoff-manual-copy` 和 `.handoff-open-link`。桌面为横向操作，`max-width: 760px` 时纵向堆叠；文本框高度至少 `120px`，官网链接具备清晰焦点样式。

- [ ] **Step 5: 验证新流程不影响 API 分支**

Run: `npx vitest run src/app/App.test.tsx -t "copies the prompt"`

Expected: PASS。

Run: `npx vitest run src/app/App.test.tsx src/features/models/web-handoff.test.ts`

Expected: PASS，并确认现有演示模型测试不请求 `window.open`。

- [ ] **Step 6: 提交网页打开流程**

```bash
git add src/features/workspace/WorkspaceView.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "feat: open DeepSeek with copied context"
```

---

### Task 4: 回答预览、手动粘贴降级与本地保存

**Files:**
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/styles/global.css`

**Interfaces:**
- Consumes: `validateImportedAnswer()`、`addMessage()`、`DEEPSEEK_WEB_ID`。
- Produces: `beginImport(): Promise<void>`、`confirmImport(): Promise<void>`、可编辑导入对话框。

- [ ] **Step 1: 写剪贴板导入与保存的失败测试**

```ts
test('previews and saves a copied DeepSeek answer', async () => {
  const readText = vi.fn().mockResolvedValue('  一个可编辑的回答  ')
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined), readText } })
  vi.spyOn(window, 'open').mockReturnValue({} as Window)
  const user = userEvent.setup()
  render(<App />)
  await openDeepSeekHandoff(user)
  await user.click(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' }))
  const preview = screen.getByRole('textbox', { name: 'DeepSeek 回答预览' })
  expect(preview).toHaveValue('一个可编辑的回答')
  await user.clear(preview)
  await user.type(preview, '编辑后的回答')
  await user.click(screen.getByRole('button', { name: '保存为 AI 回复' }))
  expect(await screen.findByText('编辑后的回答')).toBeInTheDocument()
  expect(screen.queryByLabelText('等待 DeepSeek 回答')).not.toBeInTheDocument()
})

test('falls back to manual paste when clipboard reading is denied', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn(), readText: vi.fn().mockRejectedValue(new Error('denied')) } })
  const user = userEvent.setup()
  render(<App />)
  await openDeepSeekHandoff(user)
  await user.click(screen.getByRole('button', { name: '粘贴 DeepSeek 回答' }))
  expect(screen.getByText('浏览器没有允许读取剪贴板，请在这里手动粘贴。')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'DeepSeek 回答预览' })).toHaveValue('')
})
```

Run: `npx vitest run src/app/App.test.tsx -t "DeepSeek answer|manual paste"`

Expected: FAIL，尚无导入对话框。

- [ ] **Step 2: 实现剪贴板读取和可编辑预览**

新增 `importOpen`、`importValue`、`importError`、`manualPaste` 和 `importSaving` 状态。`beginImport()` 尝试 `navigator.clipboard.readText()`；成功时 trim 后填入预览，失败时打开空预览并显示手动粘贴说明。对话框使用 `role="dialog"`、`aria-modal="true"` 和明确标题。

- [ ] **Step 3: 实现确认保存与重试**

`confirmImport()` 先调用 `validateImportedAnswer(importValue)`。验证通过后调用：

```ts
const saved = await addMessage(topic.id, {
  id: crypto.randomUUID(),
  role: 'assistant',
  content: result.value,
  modelId: DEEPSEEK_WEB_ID,
})
setMessages(current => [...current, saved])
```

保存成功后关闭预览、清空等待状态；失败时保留输入内容并在对话框显示“保存失败，请重试”。取消只关闭预览，不清空等待状态。

- [ ] **Step 4: 增加边界测试**

补充空文本、`200_001` 字符和保存接口失败测试；分别断言不调用消息 POST、显示精确错误、输入内容仍保留。运行：

Run: `npx vitest run src/app/App.test.tsx -t "DeepSeek"`

Expected: PASS。

- [ ] **Step 5: 实现响应式导入对话框样式**

增加 `.import-backdrop`、`.import-dialog`、`.import-dialog textarea`、`.import-actions`。桌面最大宽度 `640px`；移动端使用左右 `16px` 间距，按钮纵向排列且主操作在前，无横向溢出。

- [ ] **Step 6: 运行完整自动化验证**

Run: `npm test`

Expected: 所有 Vitest 测试 PASS。

Run: `npm run typecheck`

Expected: PASS。

Run: `npm run build`

Expected: PASS，生成 `dist`，无 TypeScript 或 Vite 错误。

- [ ] **Step 7: 提交回答导入流程**

```bash
git add src/features/workspace/WorkspaceView.tsx src/app/App.test.tsx src/styles/global.css
git commit -m "feat: import DeepSeek answers into topics"
```

---

### Task 5: 浏览器验收与验证记录

**Files:**
- Modify: `docs/verification/2026-08-13-mvp-fidelity.md`

**Interfaces:**
- Consumes: 完整的 DeepSeek 网页往返流程。
- Produces: 可复核的桌面、移动端、剪贴板拒绝和弹窗拦截验证记录。

- [ ] **Step 1: 启动本地应用并完成桌面主路径**

Run: `npm run dev`

在 `http://localhost:5173` 打开首个议题，选择“DeepSeek · 免费网页版”，输入问题并点击“打开并提问”。确认问题写入剪贴板、新标签页地址正确、返回后等待状态可见；用测试回答完成预览、编辑和保存。

- [ ] **Step 2: 验证权限与弹窗降级**

在浏览器站点权限中拒绝剪贴板读取，确认“粘贴 DeepSeek 回答”打开空预览和手动粘贴说明。阻止弹窗后再次点击“打开并提问”，确认页面保留提示词并显示可直接访问官网的 HTTPS 链接。

- [ ] **Step 3: 验证移动端布局**

使用 `390 × 844` 视口检查对话服务抽屉、模型选择器、等待操作条和导入对话框。确认无水平滚动、主要内容不被底部导航遮挡、按钮和输入框可完整操作。

- [ ] **Step 4: 更新验证记录**

在 `docs/verification/2026-08-13-mvp-fidelity.md` 增加“DeepSeek 免费网页版往返”小节，逐项记录：验证日期、桌面视口、移动视口、主路径结果、剪贴板拒绝结果、弹窗拦截结果、控制台错误数量以及任何有意偏差。

- [ ] **Step 5: 运行最终检查并提交验证记录**

Run: `npm test && npm run typecheck && npm run build`

Expected: 三项全部成功。

```bash
git add docs/verification/2026-08-13-mvp-fidelity.md
git commit -m "docs: verify DeepSeek web handoff"
```
