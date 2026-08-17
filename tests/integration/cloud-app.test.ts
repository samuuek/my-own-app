// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCloudApp } from "../../server/cloud/app.js";
import type { Entity } from "../../server/store.js";

function makeDependencies() {
  const entities = new Map<string, Entity>([["task-1", { id: "task-1", title: "Existing", plan_date: "2026-08-17", status: "todo" }]]);
  const store = {
    state: vi.fn(async () => ({ planItems: [...entities.values()], settings: {}, trash: [] })),
    list: vi.fn(async () => [...entities.values()]),
    get: vi.fn(async (_collection: string, id: string) => entities.get(id)!),
    create: vi.fn(async (_collection: string, input: Entity) => ({ id: "created", ...input })),
    update: vi.fn(async (_collection: string, id: string, input: Entity) => ({ ...entities.get(id), ...input, id })),
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
    savePdf: vi.fn(), readPdf: vi.fn(), removePdf: vi.fn(), saveCover: vi.fn(), readCover: vi.fn(), removeCover: vi.fn(), removeBookFiles: vi.fn(),
  };
  return { store, focusTimers, files };
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

  it("rejects foreign write origins while accepting same-origin HTTPS", async () => {
    const { instance, store } = await app();
    const rejected = await instance.inject({ method: "POST", url: "/api/collections/planItems", headers: { origin: "https://evil.example", host: "cloud.example", "x-forwarded-proto": "https" }, payload: { title: "No", plan_date: "2026-08-17" } });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("INVALID_ORIGIN");
    expect(store.create).not.toHaveBeenCalled();
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
