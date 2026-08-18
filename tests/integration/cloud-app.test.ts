// @vitest-environment node
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCloudApp } from "../../server/cloud/app.js";
import { ValidationError } from "../../server/errors.js";
import type { Entity } from "../../server/store.js";

function makeDependencies() {
  const entities = new Map<string, Entity>([
    ["task-1", { id: "task-1", title: "Existing", plan_date: "2026-08-17", status: "todo" }],
    ["book-1", { id: "book-1", title: "Protected book", author: "Original author", status: "reading", current_page: 10 }],
    ["memo-1", { id: "memo-1", content: "Convert me" }],
  ]);
  const store = {
    state: vi.fn(async () => ({ planItems: [...entities.values()], settings: {}, trash: [] })),
    list: vi.fn(async () => [...entities.values()]),
    get: vi.fn(async (_collection: string, id: string) => entities.get(id)!),
    create: vi.fn(async (_collection: string, input: Entity) => {
      const entity = { id: "created", ...input };
      entities.set(entity.id, entity);
      return entity;
    }),
    update: vi.fn(async (_collection: string, id: string, input: Entity) => {
      const entity = { ...entities.get(id), ...input, id };
      entities.set(id, entity);
      return entity;
    }),
    softDelete: vi.fn(async (_collection: string, id: string) => ({ ...entities.get(id), id, deleted_at: "2026-08-17T00:00:00.000Z" })),
    restore: vi.fn(async (_collection: string, id: string) => ({ ...entities.get(id), id, deleted_at: null })),
    permanentDelete: vi.fn(async () => undefined),
    search: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({})),
    setSettings: vi.fn(async (input: Entity) => input),
    trash: vi.fn(async () => []),
    getDailyReview: vi.fn(async () => null),
    setDailyReview: vi.fn(async (date: string, content: string) => ({ review_date: date, content })),
    transaction: vi.fn(async (work: (value: any) => Promise<any>) => work(store)),
    getForUpdate: vi.fn(async (_collection: string, id: string) => entities.get(id)!),
  };
  const focusTimers = {
    current: vi.fn(async () => null), start: vi.fn(async () => ({ id: "timer-1" })), pause: vi.fn(), resume: vi.fn(), finish: vi.fn(),
  };
  const files = {
    authorizeUpload: vi.fn(async () => ({ allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 100 * 1024 * 1024, addRandomSuffix: true, tokenPayload: "safe" })),
    completeUpload: vi.fn(async () => undefined),
    readPdf: vi.fn(), removePdf: vi.fn(), readCover: vi.fn(), removeCover: vi.fn(),
    permanentDeleteBook: vi.fn(async () => undefined), retryPendingCleanup: vi.fn(async () => undefined),
  };
  const clientUploads = vi.fn(async (options: any) => {
    if (options.body.type === "blob.generate-client-token") {
      await options.onBeforeGenerateToken(options.body.payload.pathname, options.body.payload.clientPayload, options.body.payload.multipart);
      return { type: "blob.generate-client-token", clientToken: "scoped-client-token" };
    }
    await options.onUploadCompleted(options.body.payload);
    return { type: "blob.upload-completed", response: "ok" };
  });
  return { store, focusTimers, files, clientUploads, entities };
}

const apps: Array<Awaited<ReturnType<typeof buildCloudApp>>> = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });

async function app() {
  const dependencies = makeDependencies();
  const instance = await buildCloudApp({ ...dependencies, serveStatic: false });
  apps.push(instance);
  return { instance, ...dependencies };
}

describe("cloud application", () => {
  it("uses Vercel's zero-configuration Fastify entrypoint", () => {
    const config = JSON.parse(fs.readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));
    expect(config.framework).toBe("fastify");
    expect(config.functions).toBeUndefined();
  });

  it("reports a safe connected cloud health response", async () => {
    process.env.DATABASE_URL = "must-not-leak";
    process.env.BLOB_READ_WRITE_TOKEN = "must-not-leak-either";
    const { instance } = await app();
    const response = await instance.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ application: "muzi-workspace", runtime: "cloud", database: "connected", status: "ok" });
    expect(response.body).not.toContain("must-not-leak");
  });

  it("never returns database connection details from internal errors", async () => {
    const { instance, store } = await app();
    vi.mocked(store.state).mockRejectedValueOnce(new Error("postgresql://user:secret@private-host/database"));
    const response = await instance.inject({ method: "GET", url: "/api/state" });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toEqual({ code: "APP_ERROR", message: "操作失败，请稍后重试" });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("private-host");
  });

  it("awaits state and collection writes with desktop-compatible shapes", async () => {
    const { instance, store } = await app();
    expect((await instance.inject({ method: "GET", url: "/api/state" })).json().data.planItems[0].title).toBe("Existing");
    const created = await instance.inject({ method: "POST", url: "/api/collections/planItems", headers: { origin: "https://cloud.example", host: "cloud.example" }, payload: { title: "Created", plan_date: "2026-08-17" } });
    expect(created.statusCode).toBe(201);
    expect(created.json().data.title).toBe("Created");
    const updated = await instance.inject({ method: "PATCH", url: "/api/collections/planItems/task-1", headers: { origin: "https://cloud.example", host: "cloud.example" }, payload: { title: "Updated" } });
    expect(updated.json().data.title).toBe("Updated");
    const removed = await instance.inject({ method: "DELETE", url: "/api/collections/planItems/task-1", headers: { origin: "https://cloud.example", host: "cloud.example" } });
    expect(removed.json().data.deleted_at).toBeTruthy();
    expect(store.create).toHaveBeenCalledOnce();
    expect(store.update).toHaveBeenCalledOnce();
    expect(store.softDelete).toHaveBeenCalledOnce();
  });

  it("rejects a claimed Blob pathname through generic book PATCH without changing metadata", async () => {
    const { instance, entities } = await app();
    const before = { ...entities.get("book-1") };
    const response = await instance.inject({
      method: "PATCH",
      url: "/api/collections/books/book-1",
      headers: { origin: "https://cloud.example", host: "cloud.example" },
      payload: { pdf_file_id: "reading/books/book-1/claimed.pdf" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("附件");
    expect(entities.get("book-1")).toEqual(before);
  });

  it.each([
    ["pdf_file_id", "reading/books/book-1/claimed.pdf"],
    ["pdf_filename", "claimed.pdf"],
    ["pdf_file_name", "claimed.pdf"],
    ["cover_file_id", "reading/books/book-1/claimed.webp"],
    ["cover_filename", "claimed.webp"],
    ["cover_file_name", "claimed.webp"],
  ])("rejects managed book field %s on generic create", async (field, value) => {
    const { instance, entities } = await app();
    const response = await instance.inject({
      method: "POST",
      url: "/api/collections/books",
      headers: { origin: "https://cloud.example", host: "cloud.example" },
      payload: { title: "Unsafe book", [field]: value },
    });
    expect(response.statusCode).toBe(400);
    expect(entities.has("created")).toBe(false);
  });

  it("rejects managed book fields through quick-memo conversion", async () => {
    const { instance, entities } = await app();
    const response = await instance.inject({
      method: "POST",
      url: "/api/quick-memos/memo-1/convert",
      headers: { origin: "https://cloud.example", host: "cloud.example" },
      payload: { collection: "books", fields: { cover_file_id: "reading/books/book-1/claimed.webp" } },
    });
    expect(response.statusCode).toBe(400);
    expect(entities.has("created")).toBe(false);
    expect(entities.get("memo-1")?.archived_at).toBeUndefined();
  });

  it("continues to create and update normal cloud book fields", async () => {
    const { instance, entities } = await app();
    const headers = { origin: "https://cloud.example", host: "cloud.example" };
    const created = await instance.inject({
      method: "POST", url: "/api/collections/books", headers,
      payload: { title: "Allowed book", author: "Allowed author", status: "wishlist" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().data).toMatchObject({ title: "Allowed book", author: "Allowed author", status: "wishlist" });

    const updated = await instance.inject({
      method: "PATCH", url: "/api/collections/books/book-1", headers,
      payload: { author: "Updated author", current_page: 12 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ id: "book-1", author: "Updated author", current_page: 12 });
    expect(entities.get("book-1")).toMatchObject({ author: "Updated author", current_page: 12 });
  });

  it("rejects foreign write origins while accepting same-origin HTTPS", async () => {
    const { instance, store } = await app();
    const rejected = await instance.inject({ method: "POST", url: "/api/collections/planItems", headers: { origin: "https://evil.example", host: "cloud.example", "x-forwarded-proto": "https" }, payload: { title: "No", plan_date: "2026-08-17" } });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("INVALID_ORIGIN");
    expect(store.create).not.toHaveBeenCalled();
  });

  it("exchanges a scoped upload token and validates completion without exposing the Blob secret", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "server-secret";
    const { instance, files, clientUploads } = await app();
    const payload = JSON.stringify({ bookId: "book-1", kind: "pdf", contentType: "application/pdf", originalName: "book.pdf" });
    const token = await instance.inject({
      method: "POST", url: "/api/blob/upload", headers: { origin: "https://cloud.example", host: "cloud.example" },
      payload: { type: "blob.generate-client-token", payload: { pathname: "reading/books/book-1/book.pdf", multipart: true, clientPayload: payload } },
    });
    expect(token.statusCode).toBe(200);
    expect(token.json()).toEqual({ type: "blob.generate-client-token", clientToken: "scoped-client-token" });
    expect(token.body).not.toContain("server-secret");
    expect(files.authorizeUpload).toHaveBeenCalledWith("reading/books/book-1/book.pdf", payload, true);

    const completed = await instance.inject({
      method: "POST", url: "/api/blob/upload",
      payload: { type: "blob.upload-completed", payload: { blob: { pathname: "reading/books/book-1/book-random.pdf", contentType: "application/pdf" }, tokenPayload: payload } },
    });
    expect(completed.statusCode).toBe(200);
    expect(files.completeUpload).toHaveBeenCalledWith(expect.objectContaining({ tokenPayload: payload }));
    expect(clientUploads).toHaveBeenCalledTimes(2);
  });

  it("rejects function-proxied reading uploads and uses durable deletion for books", async () => {
    const { instance, files, store } = await app();
    const proxied = await instance.inject({
      method: "PUT", url: "/api/books/book-1/pdf", headers: { "content-type": "application/pdf" }, payload: Buffer.from("%PDF-1.7"),
    });
    expect(proxied.statusCode).toBe(409);
    expect(proxied.json().error.code).toBe("DIRECT_UPLOAD_REQUIRED");

    const removed = await instance.inject({ method: "DELETE", url: "/api/collections/books/book-1/permanent" });
    expect(removed.statusCode).toBe(204);
    expect(files.permanentDeleteBook).toHaveBeenCalledWith("book-1");
    expect(store.permanentDelete).not.toHaveBeenCalled();
  });

  it("leaves an active book and its files intact when permanent deletion is requested", async () => {
    const { instance, files, store } = await app();
    vi.mocked(files.permanentDeleteBook).mockRejectedValueOnce(new ValidationError("请先将记录移入回收站"));
    const response = await instance.inject({ method: "DELETE", url: "/api/collections/books/book-1/permanent" });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toContain("回收站");
    expect(store.permanentDelete).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/system/save-and-exit"],
    ["POST", "/api/system/open-data-directory"],
    ["POST", "/api/system/open-path"],
    ["POST", "/api/backups"],
    ["PATCH", "/api/backups/backup-1/metadata"],
    ["POST", "/api/backups/backup-1/restore"],
  ])("returns DESKTOP_ONLY for %s %s", async (method, url) => {
    const { instance } = await app();
    const response = await instance.inject({ method, url, payload: method === "POST" || method === "PATCH" ? {} : undefined });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DESKTOP_ONLY");
  });

  it("returns no local backups and reports cloud providers", async () => {
    const { instance } = await app();
    expect((await instance.inject({ method: "GET", url: "/api/backups" })).json().data).toEqual([]);
    expect((await instance.inject({ method: "GET", url: "/api/system/status" })).json().data).toEqual({
      mode: "cloud",
      database: { provider: "Neon", status: "connected" },
      fileStorage: { provider: "Vercel Blob", status: "connected" },
      recovery: { provider: "Neon restore window" },
    });
  });
});
