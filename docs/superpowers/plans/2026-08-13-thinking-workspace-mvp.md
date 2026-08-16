# 思屿前端 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个可运行、可交互、可响应式浏览的“思屿”前端 MVP，完整演示今日议题、思考空间、对话旁注、纪要和思维导图主流程。

**Architecture:** 使用 React + Vite + TypeScript 的单页应用。以 feature 目录拆分首页、思考空间和知识库视图，以本地状态和 localStorage 模拟持久化；模型回复和纪要生成先使用明确标注的演示适配器，保留未来替换为服务端 API 的接口边界。

**Tech Stack:** React 19、Vite、TypeScript、Vitest、Testing Library、CSS Modules/全局设计令牌、Lucide React。

## Global Constraints

- 中文优先的响应式 Web 产品。
- 视觉气质安静、克制、可信，适合长时间阅读。
- 用户原文、AI 回复、AI 整理内容和联网来源必须明确区分。
- 第一切片不接入真实账户、数据库、支付或模型密钥。
- 旁注默认仅本地保存，不自动发送给 AI。
- 桌面正文基准 16px/1.75，移动端正文基准 16px/1.7。
- 所有交互必须支持键盘焦点，并尊重 prefers-reduced-motion。

---

### Task 1: 项目骨架与设计令牌

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/styles/global.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `App(): JSX.Element`，全局颜色、排版、间距和焦点令牌。

- [ ] 写一个失败测试，验证品牌名、主导航和今日议题标题存在。
- [ ] 运行测试并确认因 App 尚未实现而失败。
- [ ] 建立 Vite/React/TypeScript 配置、应用入口和基础 App 壳。
- [ ] 加入全局 reset、设计令牌、字体栈和可访问焦点样式。
- [ ] 运行单测、类型检查和构建并确认通过。

### Task 2: 今日议题首页

**Files:**
- Create: `src/features/topics/topic-data.ts`
- Create: `src/features/topics/TopicCard.tsx`
- Create: `src/features/topics/TodayView.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/features/topics/TodayView.test.tsx`

**Interfaces:**
- Produces: `Topic` 类型；`TodayView({ onOpenTopic })`；三类议题数据。

- [ ] 写失败测试，验证三类议题、来源时间、推荐理由和创建入口。
- [ ] 运行测试确认失败。
- [ ] 实现今日首页、继续思考区和精简议题列表。
- [ ] 实现选择议题与自建议题入口的可操作状态。
- [ ] 运行测试、类型检查并确认通过。

### Task 3: 思考空间与对话交互

**Files:**
- Create: `src/features/workspace/types.ts`
- Create: `src/features/workspace/demo-ai.ts`
- Create: `src/features/workspace/ConversationPane.tsx`
- Create: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/app/App.tsx`
- Test: `src/features/workspace/WorkspaceView.test.tsx`

**Interfaces:**
- Produces: `Message`、`Annotation`、`WorkspaceTab` 类型；`getDemoReply(input): Promise<string>`；`WorkspaceView({ topic, onBack })`。

- [ ] 写失败测试，验证发送消息、生成演示回复、添加私人旁注和切换工作区标签。
- [ ] 运行测试确认失败。
- [ ] 实现带模型/联网/上下文提示的对话栏和消息身份标签。
- [ ] 实现输入、发送、停止态、消息重点与私人旁注本地交互。
- [ ] 实现讨论、感思、资料、纪要、导图标签切换。
- [ ] 运行测试、类型检查并确认通过。

### Task 4: 纪要、导图与本地持久化

**Files:**
- Create: `src/features/workspace/SummaryPane.tsx`
- Create: `src/features/workspace/MindMapPane.tsx`
- Create: `src/lib/storage.ts`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Test: `src/lib/storage.test.ts`

**Interfaces:**
- Produces: `loadWorkspace(id)`、`saveWorkspace(id, state)`；可编辑纪要和可访问树形导图。

- [ ] 写失败测试，验证版本化 localStorage 序列化、空值回退和损坏数据回退。
- [ ] 运行测试确认失败。
- [ ] 实现版本化本地存储适配器。
- [ ] 实现带依据提示的演示纪要、章节状态和树形思维导图。
- [ ] 将思考空间消息、旁注和感思接入自动保存。
- [ ] 运行测试、类型检查并确认通过。

### Task 5: 响应式和成品验证

**Files:**
- Modify: `src/styles/global.css`
- Modify: feature component styles as needed
- Create: `docs/verification/2026-08-13-mvp-fidelity.md`

**Interfaces:**
- Consumes: 全部已完成视图。
- Produces: 桌面与移动端均可操作的成品，以及视觉核对记录。

- [ ] 启动开发服务器并浏览首页和完整思考流程。
- [ ] 在桌面和移动视口验证导航、长文本、输入框、标签和导图。
- [ ] 验证键盘焦点、减少动态效果和颜色之外的状态提示。
- [ ] 截图并核对文案、布局、排版、配色、间距、容器模型和核心交互。
- [ ] 修复核对中发现的所有可见问题。
- [ ] 运行完整测试、类型检查和生产构建。

## Scope Coverage Review

本计划实现可独立验收的前端核心闭环；真实认证、多租户隔离、PostgreSQL、模型网关、联网检索、后台队列、PDF/JSON 导出和云同步属于后续独立实施计划。当前切片不会伪装这些能力已经上线，界面中的演示生成会明确标注。
