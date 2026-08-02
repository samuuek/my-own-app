# 木子工作台

木子工作台是一款只在当前 Mac 浏览器中运行的个人工作生活管理 App。它包含首页总览、今日计划、自媒体、开发工作、咨询工作、健身计划、饮食计划、游戏娱乐、数据与设置九个页面，不需要账号、网络、云数据库或部署。

## 日常启动

双击项目根目录中的 `启动木子工作台.command`。启动器会在本机 `127.0.0.1:4317` 启动服务，并打开浏览器。首次启动若还没有生产构建，会自动执行构建。

停止时双击 `停止木子工作台.command`。启动器只会停止 PID 文件中记录且命令路径匹配本项目的进程，不会模糊查找或批量结束其他 Node 进程。

也可以在终端运行：

```bash
npm run app:start
npm run app:stop
```

## 本地数据

默认数据目录：

```text
~/Library/Application Support/MuziWorkspace/
├── data/app.sqlite
├── backups/
├── exports/
└── logs/app.log
```

主数据保存在独立 SQLite 文件中，不依赖浏览器 Local Storage、IndexedDB 或云服务。主题等偏好也保存在主数据库中。浏览器刷新、退出和本地服务重启不会清除数据。

数据与设置页可以查看并打开数据目录、创建完整备份、命名和长期保留备份、恢复历史版本、导出 JSON/CSV ZIP，以及管理回收站。

## 开发

要求 Node.js `>=22.13.0`。

```bash
npm install
npm run dev
```

开发页面为 `http://127.0.0.1:3000`，API 为 `http://127.0.0.1:4317`。两者都只监听本机回环地址。

常用命令：

```bash
npm run lint            # 静态检查
npm run typecheck       # 前后端类型检查
npm test                # 单元、组件和集成测试
npm run build           # 生产构建
npm run test:e2e        # 真实 Chromium 端到端验收
npm run test:all        # 全部检查和测试
```

## 技术结构

- React + Vite：本地桌面 Web 界面。
- Fastify：仅本机访问的 API 和生产静态文件服务。
- SQLite / better-sqlite3：独立数据文件、事务和备份。
- TanStack Query：界面数据刷新和保存状态。
- Vitest + Testing Library + Playwright：单元、集成、组件和真实浏览器验收。

更详细的使用与维护说明见 [docs/OPERATIONS.md](docs/OPERATIONS.md)，数据结构见 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)，验收覆盖见 [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)。产品范围以 [PRD.md](PRD.md) 为准。
