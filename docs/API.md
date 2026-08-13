# 本地 API 概览

生产环境 API 基址为 `http://127.0.0.1:4317/api`。接口只为当前电脑上的前端服务，不是公网 API。来自非 `localhost` / `127.0.0.1` Origin 的写请求会被拒绝。

读书模块在通用集合接口之外提供：`POST /books/:id/progress` 记录阅读进度，`PUT|GET|DELETE /books/:id/pdf` 管理 PDF，`PUT|GET|DELETE /books/:id/cover` 管理封面。PDF 最大 100 MB，封面最大 10 MB，服务端会校验实际文件头。

## 系统与读取

- `GET /api/health`：数据库完整性、迁移版本和服务状态。
- `GET /api/state`：全部未删除业务集合、设置和回收站。
- `GET /api/dashboard?date=YYYY-MM-DD`：首页当天聚合。
- `GET /api/search?q=...`：跨模块全文关键字搜索。
- `GET /api/system/status`：数据文件、目录、备份和失败状态。
- `POST /api/system/open-data-directory`：在 Finder 打开数据目录。
- `POST /api/system/open-path`：打开已经存在的本地路径。

## 集合操作

- `GET /api/collections/:collection`
- `POST /api/collections/:collection`
- `PATCH /api/collections/:collection/:id`
- `DELETE /api/collections/:collection/:id`：软删除。
- `POST /api/collections/:collection/:id/restore`
- `DELETE /api/collections/:collection/:id/permanent`

可用集合及字段白名单定义在 `server/collections.ts`，未知字段不会写入数据库。

思考模块提供两个事务接口：

- `PUT /api/reflections/daily`：按日期创建或更新唯一的每日复盘，并同步明日行动。
- `POST /api/reflection-actions/:id/add-to-plan`：把一条明日行动加入下一日计划；已有有效关联时不会重复创建。

## 业务动作

- `POST /api/plan-items/:id/complete`
- `POST /api/plan-items/:id/postpone`
- `GET|PUT /api/daily-reviews/:date`
- `POST /api/quick-memos/:id/convert`
- `GET|PUT /api/settings`
- `GET /api/trash`

## 备份与导出

- `GET /api/backups`
- `POST /api/backups`
- `PATCH /api/backups/:id/metadata`
- `POST /api/backups/:id/restore`
- `POST /api/export`
- `GET /api/exports/:filename`

所有 JSON 响应的成功数据位于 `{ "data": ... }`；错误结构为 `{ "error": { "code": "...", "message": "..." } }`。
