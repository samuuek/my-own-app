import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { getAppPaths, type AppPaths } from "./config.js";
import { DatabaseManager } from "./database.js";
import { AppStore, NotFoundError, ValidationError } from "./store.js";
import { BackupManager } from "./backup.js";
import { buildDashboard } from "./dashboard.js";
import { collectionDefinitions, isCollectionName, sourceCollectionByType } from "./collections.js";

const bodySchema = z.record(z.string(), z.unknown());

export type BuildAppOptions = {
  dataDir?: string;
  logger?: boolean;
  serveStatic?: boolean;
  autoBackup?: boolean;
};

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const paths = getAppPaths(options.dataDir);
  const manager = new DatabaseManager(paths);
  const store = new AppStore(manager);
  const backups = new BackupManager(manager, store, paths);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return reply.code(403).send({ error: { code: "INVALID_ORIGIN", message: "请求来源无效" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const appError = error as Error & { statusCode?: number };
    const statusCode = error instanceof ValidationError || error instanceof NotFoundError
      ? error.statusCode
      : appError.statusCode && Number(appError.statusCode) < 500
        ? Number(appError.statusCode)
        : 500;
    const message = statusCode >= 500 ? `操作失败：${appError.message}` : appError.message;
    reply.code(statusCode).send({ error: { code: appError.name || "APP_ERROR", message } });
  });

  app.get("/api/health", async () => ({
    data: {
      status: "ok",
      database: manager.integrityCheck(),
      schemaVersion: latestSchemaVersion(manager),
      now: new Date().toISOString(),
    },
  }));

  app.get("/api/state", async () => ({ data: store.state() }));

  app.get("/api/dashboard", async (request) => {
    const query = request.query as { date?: string };
    const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : localDate();
    return { data: buildDashboard(store, date) };
  });

  app.get("/api/search", async (request) => {
    const query = request.query as { q?: string };
    return { data: store.search(query.q ?? "") };
  });

  app.get("/api/collections/:collection", async (request) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const query = request.query as { includeDeleted?: string };
    return { data: store.list(collection, query.includeDeleted === "true") };
  });

  app.post("/api/collections/:collection", async (request, reply) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const input = bodySchema.parse(request.body ?? {});
    const entity = store.create(collection, input);
    return reply.code(201).send({ data: entity });
  });

  app.patch("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.update(collection, id, bodySchema.parse(request.body ?? {})) };
  });

  app.delete("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.softDelete(collection, id) };
  });

  app.post("/api/collections/:collection/:id/restore", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: store.restore(collection, id) };
  });

  app.delete("/api/collections/:collection/:id/permanent", async (request, reply) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    store.permanentDelete(collection, id);
    return reply.code(204).send();
  });

  app.post("/api/plan-items/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    const item = store.get("planItems", id);
    const now = new Date().toISOString();
    const updated = store.update("planItems", id, { status: "done", completed_at: now });
    if (item.complete_source && item.source_entity_type && item.source_entity_id) {
      const collection = sourceCollectionByType[item.source_entity_type];
      if (collection) {
        const statusField = collection === "workouts" ? "completed" : "done";
        const definition = collectionDefinitions[collection];
        if (definition.fields.includes("status" as never)) {
          store.update(collection, item.source_entity_id, { status: statusField });
        }
      }
    }
    return { data: updated };
  });

  app.post("/api/plan-items/:id/postpone", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.body);
    return { data: store.update("planItems", id, { plan_date: body.date, status: "todo", completed_at: null }) };
  });

  app.get("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    return { data: store.getDailyReview(date) };
  });

  app.put("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    const body = z.object({ content: z.string() }).parse(request.body);
    return { data: store.setDailyReview(date, body.content) };
  });

  app.post("/api/quick-memos/:id/convert", async (request) => {
    const { id } = request.params as { id: string };
    const memo = store.get("quickMemos", id);
    const body = z.object({ collection: z.string(), fields: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    assertCollection(body.collection);
    const titleField = collectionDefinitions[body.collection].title;
    const converted = store.create(body.collection, {
      ...body.fields,
      [titleField]: body.fields[titleField] ?? memo.content,
    });
    store.update("quickMemos", id, { converted_type: body.collection, converted_id: converted.id, archived_at: new Date().toISOString() });
    return { data: converted };
  });

  app.get("/api/settings", async () => ({ data: store.getSettings() }));
  app.put("/api/settings", async (request) => ({ data: store.setSettings(bodySchema.parse(request.body ?? {})) }));
  app.get("/api/trash", async () => ({ data: store.trash() }));

  app.get("/api/system/status", async () => ({ data: systemStatus(paths, backups) }));
  app.get("/api/system/data-file", async () => ({ data: fileInfo(paths.dataFile) }));
  app.post("/api/system/open-data-directory", async () => {
    openPath(paths.root);
    return { data: { opened: true, path: paths.root } };
  });
  app.post("/api/system/open-path", async (request) => {
    const body = z.object({ path: z.string().min(1) }).parse(request.body);
    if (!fs.existsSync(body.path)) throw new ValidationError("这个本地路径不存在");
    openPath(path.resolve(body.path));
    return { data: { opened: true } };
  });

  app.get("/api/backups", async () => ({ data: backups.list() }));
  app.post("/api/backups", async (request, reply) => {
    const body = z.object({ label: z.string().default(""), keep: z.boolean().default(false) }).parse(request.body ?? {});
    const backup = await backups.create("manual", body.label, body.keep);
    return reply.code(201).send({ data: backup });
  });
  app.patch("/api/backups/:id/metadata", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ label: z.string().optional(), keep: z.boolean().optional() }).parse(request.body ?? {});
    return { data: backups.updateMetadata(id, body) };
  });
  app.post("/api/backups/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    await backups.restore(id);
    return { data: { restored: true } };
  });

  app.post("/api/export", async (_request, reply) => {
    const result = await backups.exportAll();
    return reply.code(201).send({ data: { ...result, downloadUrl: `/api/exports/${encodeURIComponent(result.filename)}` } });
  });
  app.get("/api/exports/:filename", async (request, reply) => {
    const { filename } = request.params as { filename: string };
    if (path.basename(filename) !== filename) throw new ValidationError("导出文件路径无效");
    const file = path.resolve(paths.exportsDir, filename);
    if (!file.startsWith(`${path.resolve(paths.exportsDir)}${path.sep}`) || !fs.existsSync(file)) throw new NotFoundError("没有找到导出文件");
    reply.header("Content-Disposition", `attachment; filename="${filename}"`);
    reply.type("application/zip");
    return reply.send(fs.createReadStream(file));
  });

  if (options.serveStatic ?? process.env.NODE_ENV === "production") {
    const root = path.resolve("dist");
    await app.register(fastifyStatic, { root, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => manager.close());

  if (options.autoBackup ?? process.env.NODE_ENV !== "test") {
    void backups.ensureDailyBackup().catch((error) => app.log.error(error, "自动备份失败"));
  }

  return app;
}

function assertCollection(value: string): asserts value is keyof typeof collectionDefinitions {
  if (!isCollectionName(value)) throw new NotFoundError("模块不存在");
}

function latestSchemaVersion(manager: DatabaseManager): string | null {
  const row = manager.db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: string } | undefined;
  return row?.version ?? null;
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function fileInfo(file: string): Record<string, any> {
  const stat = fs.statSync(file);
  let writable = true;
  try {
    fs.accessSync(file, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  return { path: file, size: stat.size, modifiedAt: stat.mtime.toISOString(), writable };
}

function systemStatus(paths: AppPaths, backups: BackupManager): Record<string, any> {
  return {
    dataFile: fileInfo(paths.dataFile),
    dataDirectory: paths.root,
    backupsDirectory: paths.backupsDir,
    exportsDirectory: paths.exportsDir,
    latestBackup: backups.list()[0] ?? null,
    backupStatus: backups.getStatus(),
  };
}

function openPath(target: string): void {
  const child = spawn("open", [target], { detached: true, stdio: "ignore" });
  child.unref();
}
