# 思屿多模型网关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为思屿加入豆包、千问、DeepSeek 和自定义 OpenAI 兼容服务的安全本地 API 入口，并允许用户在对话中选择可用模型。

**Architecture:** Vite 本地服务通过 `/api/models` 暴露不含密钥的模型状态，通过 `/api/chat` 在服务端读取环境变量并转发 OpenAI 兼容请求。前端只保存模型 ID，永不接触 API Key；未配置密钥时自动保留演示模型。

**Tech Stack:** React、TypeScript、Vite 本地中间件、Vitest、OpenAI-compatible Chat Completions HTTP。

## Global Constraints

- API Key 不得进入前端 bundle、localStorage、日志或错误正文。
- 豆包、千问、DeepSeek 使用各自服务端 Base URL；WorkBuddy 以自定义 OpenAI 兼容入口处理。
- 模型切换必须清楚展示厂商、可用状态和演示状态。
- 沿用现有低饱和蓝绿色、开放列表和长文阅读设计系统。

---

### Task 1: 模型注册表与安全网关

**Files:**
- Create: `src/server/modelGateway.ts`
- Create: `src/server/modelGateway.test.ts`
- Modify: `vite.config.ts`
- Create: `.env.example`

**Interfaces:**
- Produces: `publicModels(env)`、`chatWithModel(request, env, fetcher)`、`modelGatewayPlugin()`。

- [ ] 写失败测试：公开模型列表不泄露密钥，未配置模型不可用，演示模型始终可用。
- [ ] 写失败测试：网关拒绝未知模型，并以 Bearer 认证转发兼容请求。
- [ ] 实现注册表、输入校验、错误脱敏和 Vite `/api` 中间件。
- [ ] 运行网关测试确认通过。

### Task 2: 前端模型设置与选择

**Files:**
- Create: `src/features/models/model-api.ts`
- Create: `src/features/models/ModelSettings.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/features/workspace/WorkspaceView.tsx`
- Modify: `src/styles/global.css`
- Test: `src/app/App.test.tsx`

**Interfaces:**
- Produces: `ModelInfo`、`fetchModels()`、`sendChat()`；设置抽屉和对话模型选择器。

- [ ] 写失败测试：设置入口展示四个供应商，对话可以选择模型。
- [ ] 实现设置抽屉、状态说明、环境变量引导和可访问关闭按钮。
- [ ] 将发送消息接入 `/api/chat`，显示等待与失败状态，演示模型保持离线可用。
- [ ] 运行前端测试、类型检查与构建。

### Task 3: 浏览器端到端验证

**Files:**
- Modify: `docs/verification/2026-08-13-mvp-fidelity.md`

**Interfaces:**
- Consumes: 完整模型设置和对话流程。

- [ ] 打开设置，核对供应商状态和密钥安全文案。
- [ ] 选择演示模型完成一次对话。
- [ ] 验证桌面和移动端无溢出、无控制台错误。
- [ ] 运行完整测试和生产构建。
