// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../server/app.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
afterEach(() => { if (directory) removeTestDirectory(directory); directory = ""; });

describe("application health", () => {
  it("starts on loopback and reports a healthy migrated database", async () => {
    directory = makeTestDirectory("health");
    const app = await buildApp({ dataDir: directory, autoBackup: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const address = app.server.address();
      expect(address && typeof address === "object" ? address.address : "").toBe("127.0.0.1");
      const response = await app.inject({ method: "GET", url: "/api/health" });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ status: "ok", database: "ok", schemaVersion: "002_workout_body_part.sql" });
    } finally {
      await app.close();
    }
  });

  it("rejects state-changing requests from non-local browser origins", async () => {
    directory = makeTestDirectory("origin");
    const app = await buildApp({ dataDir: directory, autoBackup: false });
    try {
      const response = await app.inject({ method: "POST", url: "/api/collections/planItems", headers: { origin: "https://example.com" }, payload: { title: "不应写入", plan_date: "2026-08-02" } });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
