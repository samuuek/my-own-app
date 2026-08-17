import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { Readable } from "node:stream";
import { z } from "zod";
import { collectionDefinitions, isCollectionName } from "../collections.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { buildCloudDashboard } from "./dashboard.js";
import { readCloudConfig } from "./config.js";
import { CloudDatabase } from "./database.js";
import { CloudExportService } from "./export.js";
import { CloudFocusTimerService } from "./focus-timer.js";
import { CloudReadingFileManager } from "./reading-files.js";
import { CloudStore } from "./store.js";
import { cloudSystemStatus, DesktopOnlyError, isAllowedWriteOrigin } from "./system.js";
import { CloudWorkflowService } from "./workflows.js";

const bodySchema = z.record(z.string(), z.unknown());

type FocusTimers = Pick<CloudFocusTimerService, "current" | "start" | "pause" | "resume" | "finish">;
type ReadingFiles = Pick<CloudReadingFileManager, "savePdf" | "readPdf" | "removePdf" | "saveCover" | "readCover" | "removeCover" | "removeBookFiles">;
type ExportService = Pick<CloudExportService, "create" | "read">;

export type BuildCloudAppOptions = {
  store?: CloudStore;
  focusTimers?: FocusTimers;
  files?: ReadingFiles;
  exports?: ExportService;
  logger?: boolean;
  serveStatic?: boolean;
};

export async function buildCloudApp(options: BuildCloudAppOptions = {}): Promise<FastifyInstance> {
  const store = options.store ?? createDefaultStore();
  const focusTimers = options.focusTimers ?? new CloudFocusTimerService(store);
  const files = options.files ?? new CloudReadingFileManager(store);
  const exports = options.exports ?? new CloudExportService(store);
  const workflows = new CloudWorkflowService(store);
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 * 1024 * 1024 });

  app.addContentTypeParser("application/pdf", { parseAs: "buffer", bodyLimit: 100 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  for (const type of ["image/png", "image/jpeg", "image/webp"]) {
    app.addContentTypeParser(type, { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 }, (_request, body, done) => done(null, body));
  }

  app.addHook("onRequest", async (request, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(request.method)) return;
    const hostHeader = String(request.headers["x-forwarded-host"] ?? request.headers.host ?? "").split(",")[0].trim();
    const protocol = typeof request.headers["x-forwarded-proto"] === "string" ? request.headers["x-forwarded-proto"] : undefined;
    if (!isAllowedWriteOrigin(request.headers.origin, hostHeader, "cloud", protocol)) {
      return reply.code(403).send({ error: { code: "INVALID_ORIGIN", message: "请求来源无效" } });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    const appError = error as Error & { statusCode?: number; code?: string };
    const statusCode = error instanceof ValidationError || error instanceof NotFoundError || error instanceof DesktopOnlyError
      ? error.statusCode
      : appError.statusCode && Number(appError.statusCode) < 500
        ? Number(appError.statusCode)
        : 500;
    const internal = statusCode >= 500;
    if (internal) app.log.error(error);
    const message = internal ? "操作失败，请稍后重试" : appError.message;
    const code = internal ? "APP_ERROR" : appError.code || appError.name || "APP_ERROR";
    reply.code(statusCode).send({ error: { code, message } });
  });

  app.get("/api/health", async () => ({
    data: {
      application: "muzi-workspace",
      runtime: "cloud",
      buildId: process.env.MUZI_BUILD_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "development",
      status: "ok",
      database: "connected",
      now: new Date().toISOString(),
    },
  }));

  app.get("/api/state", async () => ({ data: await store.state() }));
  app.get("/api/dashboard", async (request) => {
    const query = request.query as { date?: string };
    const date = query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date) ? query.date : localDate();
    return { data: await buildCloudDashboard(store, date, focusTimers) };
  });
  app.get("/api/focus-timers/current", async () => ({ data: await focusTimers.current() }));
  app.post("/api/focus-timers", async (request, reply) => {
    const body = z.object({
      planItemId: z.string().nullable().default(null),
      plannedMinutes: z.number().int().min(1).max(480),
    }).parse(request.body ?? {});
    return reply.code(201).send({ data: await focusTimers.start(body) });
  });
  app.post("/api/focus-timers/:id/pause", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await focusTimers.pause(id) };
  });
  app.post("/api/focus-timers/:id/resume", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await focusTimers.resume(id) };
  });
  app.post("/api/focus-timers/:id/finish", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ status: z.enum(["completed", "cancelled"]).default("completed") }).parse(request.body ?? {});
    return { data: await focusTimers.finish(id, body.status) };
  });

  app.get("/api/search", async (request) => {
    const query = request.query as { q?: string };
    return { data: await store.search(query.q ?? "") };
  });
  app.get("/api/collections/:collection", async (request) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const query = request.query as { includeDeleted?: string };
    return { data: await store.list(collection, query.includeDeleted === "true") };
  });
  app.post("/api/collections/:collection", async (request, reply) => {
    const { collection } = request.params as { collection: string };
    assertCollection(collection);
    const entity = await store.create(collection, bodySchema.parse(request.body ?? {}));
    return reply.code(201).send({ data: entity });
  });
  app.patch("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: await store.update(collection, id, bodySchema.parse(request.body ?? {})) };
  });
  app.delete("/api/collections/:collection/:id", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: await store.softDelete(collection, id) };
  });
  app.post("/api/collections/:collection/:id/restore", async (request) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    return { data: await store.restore(collection, id) };
  });
  app.delete("/api/collections/:collection/:id/permanent", async (request, reply) => {
    const { collection, id } = request.params as { collection: string; id: string };
    assertCollection(collection);
    const readingBook = collection === "books" ? await store.get("books", id, true) : null;
    await store.permanentDelete(collection, id);
    if (readingBook) await files.removeBookFiles(readingBook);
    return reply.code(204).send();
  });

  app.post("/api/plan-items/:id/complete", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await workflows.completePlan(id) };
  });
  app.post("/api/books/:id/progress", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = z.object({
      session_date: z.string().min(1),
      start_page: z.number().int().nonnegative(),
      end_page: z.number().int().nonnegative(),
      duration_minutes: z.number().int().nonnegative().default(0),
      notes: z.string().default(""),
    }).parse(request.body ?? {});
    return reply.code(201).send({ data: await workflows.recordReadingProgress(id, input) });
  });
  app.put("/api/reflections/daily", async (request) => {
    const input = z.object({
      reflection_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), source_category: z.string(), source_detail: z.string().default(""),
      work_summary: z.string().default(""), life_summary: z.string().default(""), gains: z.string().default(""),
      problems: z.string().default(""), improvements: z.string().default(""),
      actions: z.array(z.object({ id: z.string().optional(), content: z.string().min(1) })).default([]),
    }).parse(request.body ?? {});
    return { data: await workflows.saveDailyReflection(input) };
  });
  app.post("/api/reflection-actions/:id/add-to-plan", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await workflows.addReflectionActionToPlan(id) };
  });

  app.put("/api/books/:id/pdf", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await files.savePdf(id, request.body as Buffer, String(request.headers["x-file-name"] ?? "book.pdf")) };
  });
  app.get("/api/books/:id/pdf", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await files.readPdf(id);
    reply.type(result.contentType);
    reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(String(result.book.pdf_filename ?? "book.pdf"))}`);
    return reply.send(toNodeStream(result.body));
  });
  app.delete("/api/books/:id/pdf", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await files.removePdf(id) };
  });
  app.put("/api/books/:id/cover", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await files.saveCover(id, request.body as Buffer, String(request.headers["content-type"] ?? ""), String(request.headers["x-file-name"] ?? "cover")) };
  });
  app.get("/api/books/:id/cover", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await files.readCover(id);
    reply.type(result.contentType);
    return reply.send(toNodeStream(result.body));
  });
  app.delete("/api/books/:id/cover", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await files.removeCover(id) };
  });

  app.post("/api/plan-items/:id/postpone", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.body);
    return { data: await workflows.postponePlan(id, body.date) };
  });
  app.get("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    return { data: await store.getDailyReview(date) };
  });
  app.put("/api/daily-reviews/:date", async (request) => {
    const { date } = request.params as { date: string };
    const body = z.object({ content: z.string() }).parse(request.body);
    return { data: await store.setDailyReview(date, body.content) };
  });
  app.post("/api/quick-memos/:id/convert", async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ collection: z.string(), fields: z.record(z.string(), z.unknown()).default({}) }).parse(request.body);
    assertCollection(body.collection);
    return { data: await workflows.convertQuickMemo(id, body.collection, body.fields) };
  });

  app.get("/api/settings", async () => ({ data: await store.getSettings() }));
  app.put("/api/settings", async (request) => ({ data: await store.setSettings(bodySchema.parse(request.body ?? {})) }));
  app.get("/api/trash", async () => ({ data: await store.trash() }));

  app.get("/api/system/status", async () => ({ data: cloudSystemStatus() }));
  app.get("/api/system/data-file", async () => { throw new DesktopOnlyError(); });
  app.post("/api/system/save", async () => ({ data: { savedAt: new Date().toISOString(), database: "connected", runtime: "cloud" } }));
  app.post("/api/system/save-and-exit", async () => { throw new DesktopOnlyError(); });
  app.post("/api/system/open-data-directory", async () => { throw new DesktopOnlyError(); });
  app.post("/api/system/open-path", async () => { throw new DesktopOnlyError(); });
  app.get("/api/backups", async () => ({ data: [] }));
  app.post("/api/backups", async () => { throw new DesktopOnlyError(); });
  app.patch("/api/backups/:id/metadata", async () => { throw new DesktopOnlyError(); });
  app.post("/api/backups/:id/restore", async () => { throw new DesktopOnlyError(); });

  app.post("/api/export", async (_request, reply) => reply.code(201).send({ data: await exports.create() }));
  app.get("/api/cloud-exports/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const result = await exports.read(token);
    reply.header("Content-Disposition", `attachment; filename="${safeHeaderFilename(result.filename)}"`);
    reply.type("application/zip");
    return reply.send(toNodeStream(result.body));
  });
  app.get("/api/exports/:filename", async () => { throw new DesktopOnlyError(); });

  if (options.serveStatic ?? process.env.NODE_ENV === "production") {
    await app.register(fastifyStatic, {
      root: path.resolve("dist"),
      wildcard: true,
      setHeaders: (response, filePath) => {
        response.setHeader("Cache-Control", filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
      if (request.url.startsWith("/assets/")) return reply.code(404).send({ error: { code: "ASSET_NOT_FOUND", message: "页面资源不存在，请刷新后重试" } });
      return reply.header("Cache-Control", "no-cache").sendFile("index.html");
    });
  }

  return app;
}

function createDefaultStore(): CloudStore {
  const config = readCloudConfig();
  return new CloudStore(new CloudDatabase(config.databaseUrl));
}

function assertCollection(value: string): asserts value is keyof typeof collectionDefinitions {
  if (!isCollectionName(value)) throw new NotFoundError("模块不存在");
}

function localDate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

function toNodeStream(body: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);
}

function safeHeaderFilename(value: string): string {
  return value.replace(/[\r\n"]/g, "");
}
