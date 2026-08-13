// @vitest-environment node
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { getAppPaths } from "../../server/config.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
let app: FastifyInstance;
beforeEach(async () => { directory = makeTestDirectory("reading-files"); app = await buildApp({ dataDir: directory, autoBackup: false }); });
afterEach(async () => { await app.close(); removeTestDirectory(directory); });

describe("reading attachments", () => {
  it("rejects invalid PDFs and stores valid PDFs behind a book route", async () => {
    const created = await app.inject({ method: "POST", url: "/api/collections/books", payload: { title: "测试书" } });
    const id = created.json().data.id;
    const bad = await app.inject({ method: "PUT", url: `/api/books/${id}/pdf`, headers: { "content-type": "application/pdf", "x-file-name": "bad.pdf" }, payload: Buffer.from("not pdf") });
    expect(bad.statusCode).toBe(400);
    const pdf = Buffer.from("%PDF-1.4\n%%EOF");
    const good = await app.inject({ method: "PUT", url: `/api/books/${id}/pdf`, headers: { "content-type": "application/pdf", "x-file-name": "sample.pdf" }, payload: pdf });
    expect(good.statusCode).toBe(200);
    expect(good.json().data.pdf_filename).toBe("sample.pdf");
    const read = await app.inject({ method: "GET", url: `/api/books/${id}/pdf` });
    expect(read.statusCode).toBe(200);
    expect(read.rawPayload).toEqual(pdf);
    expect(fs.readdirSync(getAppPaths(directory).readingFilesDir)).toHaveLength(1);
  });

  it("stores an optional cover and includes reading attachments in export", async () => {
    const created = await app.inject({ method: "POST", url: "/api/collections/books", payload: { title: "有封面的书" } });
    const id = created.json().data.id;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const cover = await app.inject({ method: "PUT", url: `/api/books/${id}/cover`, headers: { "content-type": "image/png", "x-file-name": "cover.png" }, payload: png });
    expect(cover.statusCode).toBe(200);
    expect(cover.json().data.cover_filename).toBe("cover.png");
    const read = await app.inject({ method: "GET", url: `/api/books/${id}/cover` });
    expect(read.rawPayload).toEqual(png);
  });
});
