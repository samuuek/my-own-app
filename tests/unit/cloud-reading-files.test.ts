// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudReadingFileManager, type CloudBlobClient } from "../../server/cloud/reading-files.js";
import { NotFoundError } from "../../server/errors.js";
import type { Entity } from "../../server/store.js";

function stream(text = "content"): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

function byteStream(bytes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.from(bytes)); controller.close(); } });
}

const pdfHeader = [...new TextEncoder().encode("%PDF-1.7\n")];
const webpHeader = [...new TextEncoder().encode("RIFFxxxxWEBP")];

type Cleanup = { pathname: string; reason: string; attempts: number; last_error: string | null };

function setup(book: Entity = {
  id: "book-1", title: "Cloud book",
  pdf_file_id: "reading/books/book-1/old.pdf",
  cover_file_id: "reading/books/book-1/old.webp",
}) {
  let current: Entity | null = { ...book };
  let permanentlyDeleted = false;
  const cleanup = new Map<string, Cleanup>();
  const store: any = {
    get: vi.fn(async () => {
      if (!current) throw new NotFoundError("record is missing");
      return { ...current };
    }),
    getForUpdate: vi.fn(async () => {
      if (!current) throw new NotFoundError("record is missing");
      return { ...current };
    }),
    update: vi.fn(async (_collection: string, _id: string, input: Entity) => {
      if (!current) throw new NotFoundError("record is missing");
      current = { ...current, ...input };
      return { ...current };
    }),
    permanentDelete: vi.fn(async () => {
      if (!current?.deleted_at) return false;
      permanentlyDeleted = true;
      current = null;
      return true;
    }),
    transaction: vi.fn(async (work: (transactionStore: any) => Promise<any>) => work(store)),
    enqueueBlobCleanup: vi.fn(async (pathname: string, reason: string) => {
      cleanup.set(pathname, { pathname, reason, attempts: cleanup.get(pathname)?.attempts ?? 0, last_error: null });
    }),
    listBlobCleanup: vi.fn(async () => [...cleanup.values()]),
    completeBlobCleanup: vi.fn(async (pathname: string) => { cleanup.delete(pathname); }),
    failBlobCleanup: vi.fn(async (pathname: string, message: string) => {
      const record = cleanup.get(pathname)!;
      cleanup.set(pathname, { ...record, attempts: record.attempts + 1, last_error: message });
    }),
  };
  const blob: CloudBlobClient = {
    get: vi.fn(async (pathname) => ({
      body: pathname.endsWith(".pdf") ? byteStream(pdfHeader) : byteStream(webpHeader),
      contentType: pathname.endsWith(".pdf") ? "application/pdf" : "image/webp",
    })),
    del: vi.fn(async () => undefined),
  };
  return {
    manager: new CloudReadingFileManager(store, blob), store, blob, cleanup,
    current: () => current as Entity, permanentlyDeleted: () => permanentlyDeleted,
  };
}

function uploadPayload(kind: "pdf" | "cover", contentType: string, originalName: string) {
  return JSON.stringify({ bookId: "book-1", kind, contentType, originalName });
}

describe("CloudReadingFileManager direct uploads", () => {
  it("authorizes a private 100 MB PDF only for an existing book and exact pathname", async () => {
    const { manager, store } = setup();
    const result = await manager.authorizeUpload(
      "reading/books/book-1/book.pdf",
      uploadPayload("pdf", "application/pdf", "../cloud\r\n.pdf"),
      true,
    );
    expect(store.get).toHaveBeenCalledWith("books", "book-1");
    expect(result).toEqual({
      allowedContentTypes: ["application/pdf"],
      maximumSizeInBytes: 100 * 1024 * 1024,
      addRandomSuffix: true,
      tokenPayload: JSON.stringify({ bookId: "book-1", kind: "pdf", contentType: "application/pdf", originalName: "cloud.pdf" }),
    });
    await expect(manager.authorizeUpload(
      "reading/books/another/book.pdf",
      uploadPayload("pdf", "application/pdf", "cloud.pdf"),
      true,
    )).rejects.toThrow("上传路径无效");
  });

  it.each([
    ["image/png", "png"], ["image/jpeg", "jpg"], ["image/webp", "webp"],
  ])("authorizes a private 10 MB %s cover with a matching path", async (contentType, extension) => {
    const { manager } = setup();
    const result = await manager.authorizeUpload(
      `reading/books/book-1/cover.${extension}`,
      uploadPayload("cover", contentType, "cover"),
      false,
    );
    expect(result).toMatchObject({
      allowedContentTypes: [contentType],
      maximumSizeInBytes: 10 * 1024 * 1024,
      addRandomSuffix: true,
    });
  });

  it("commits metadata only from a validated upload-completed callback", async () => {
    const { manager, store, blob, cleanup, current } = setup();
    await manager.completeUpload({
      blob: { pathname: "reading/books/book-1/book-random.pdf", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "Cloud book.pdf"),
    });
    expect(store.update).toHaveBeenCalledWith("books", "book-1", {
      pdf_file_id: "reading/books/book-1/book-random.pdf",
      pdf_filename: "Cloud book.pdf",
    });
    expect(blob.del).toHaveBeenCalledWith("reading/books/book-1/old.pdf");
    expect(cleanup.size).toBe(0);
    expect(current().pdf_file_id).toBe("reading/books/book-1/book-random.pdf");
    expect(blob.get).toHaveBeenCalledWith("reading/books/book-1/book-random.pdf", { access: "private" });

    await expect(manager.completeUpload({
      blob: { pathname: "exports/stolen.zip", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "Cloud book.pdf"),
    })).rejects.toThrow("上传路径无效");
  });

  it.each([
    ["image/png", "png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    ["image/jpeg", "jpg", [0xff, 0xd8, 0xff, 0x00]],
    ["image/webp", "webp", webpHeader],
  ])("sniffs a real %s prefix before committing cover metadata", async (contentType, extension, header) => {
    const { manager, blob, current } = setup({ id: "book-1", title: "Cloud book" });
    vi.mocked(blob.get).mockResolvedValueOnce({ body: byteStream(header), contentType });
    await manager.completeUpload({
      blob: { pathname: `reading/books/book-1/cover-random.${extension}`, contentType },
      tokenPayload: uploadPayload("cover", contentType, `cover.${extension}`),
    });
    expect(current().cover_file_id).toBe(`reading/books/book-1/cover-random.${extension}`);
  });

  it.each([
    ["invalid bytes", async () => ({ body: stream("not-a-pdf"), contentType: "application/pdf" })],
    ["private read failure", async () => { throw new Error("private token secret"); }],
  ])("queues an uncommitted upload when prefix validation has %s", async (_case, getResult) => {
    const { manager, blob, cleanup, current } = setup({ id: "book-1", title: "Cloud book" });
    vi.mocked(blob.get).mockImplementationOnce(getResult);
    vi.mocked(blob.del).mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(manager.completeUpload({
      blob: { pathname: "reading/books/book-1/book-random.pdf", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "book.pdf"),
    })).rejects.toThrow(/有效的 PDF|无法验证上传文件/);
    expect(current().pdf_file_id).toBeUndefined();
    expect(cleanup.get("reading/books/book-1/book-random.pdf")).toMatchObject({ reason: "invalid-upload" });
  });

  it.each(["soft", "permanent"])("keeps cleanup intent for an authorize → %s-delete → complete race", async (mode) => {
    const { manager, store, blob, cleanup, current } = setup({ id: "book-1", title: "Cloud book" });
    const payload = uploadPayload("pdf", "application/pdf", "book.pdf");
    await manager.authorizeUpload("reading/books/book-1/book.pdf", payload, true);
    if (mode === "soft") {
      current().deleted_at = new Date().toISOString();
      store.getForUpdate.mockRejectedValueOnce(new Error("record is deleted"));
    } else {
      store.get.mockRejectedValue(new NotFoundError("record is missing"));
      store.getForUpdate.mockRejectedValueOnce(new NotFoundError("record is missing"));
    }
    vi.mocked(blob.del).mockRejectedValueOnce(new Error("cleanup unavailable"));
    await expect(manager.completeUpload({
      blob: { pathname: "reading/books/book-1/book-race.pdf", contentType: "application/pdf" },
      tokenPayload: payload,
    })).rejects.toThrow(/record is/);
    expect(current().pdf_file_id).toBeUndefined();
    expect(cleanup.get("reading/books/book-1/book-race.pdf")).toMatchObject({ reason: "upload-metadata-failed" });
  });

  it("does not clean up an upload that became current when the transaction result is uncertain", async () => {
    const { manager, store, blob, cleanup, current } = setup({ id: "book-1", title: "Cloud book" });
    store.transaction.mockImplementationOnce(async (work: (transactionStore: any) => Promise<any>) => {
      await work(store);
      throw new Error("commit response lost");
    });
    await expect(manager.completeUpload({
      blob: { pathname: "reading/books/book-1/book-current.pdf", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "book.pdf"),
    })).rejects.toThrow("commit response lost");
    expect(current().pdf_file_id).toBe("reading/books/book-1/book-current.pdf");
    expect(cleanup.has("reading/books/book-1/book-current.pdf")).toBe(false);
    expect(blob.del).not.toHaveBeenCalled();
  });
});

describe("CloudReadingFileManager durable cleanup", () => {
  it.each([
    ["removePdf", "pdf_file_id", "reading/books/book-1/old.pdf"],
    ["removeCover", "cover_file_id", "reading/books/book-1/old.webp"],
  ] as const)("keeps durable cleanup intent when %s cannot delete Blob", async (method, field, pathname) => {
    const { manager, blob, cleanup, current } = setup();
    vi.mocked(blob.del).mockRejectedValueOnce(new Error("Blob unavailable"));
    await manager[method]("book-1");
    expect(current()[field]).toBeNull();
    expect(cleanup.get(pathname)).toMatchObject({ attempts: 1, last_error: "Blob unavailable" });

    await manager.retryPendingCleanup();
    expect(cleanup.has(pathname)).toBe(false);
    expect(blob.del).toHaveBeenCalledTimes(2);
  });

  it("retains old replacement cleanup after callback deletion fails and retries it", async () => {
    const { manager, blob, cleanup, current } = setup();
    vi.mocked(blob.del).mockRejectedValueOnce(new Error("temporary delete failure"));
    await manager.completeUpload({
      blob: { pathname: "reading/books/book-1/book-random.pdf", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "new.pdf"),
    });
    expect(current().pdf_file_id).toBe("reading/books/book-1/book-random.pdf");
    expect(cleanup.has("reading/books/book-1/old.pdf")).toBe(true);
    await manager.retryPendingCleanup();
    expect(cleanup.size).toBe(0);
  });

  it("rejects permanent deletion of an active book without touching attachments", async () => {
    const { manager, blob, cleanup, permanentlyDeleted } = setup({
      id: "book-1", title: "Cloud book", deleted_at: null,
      pdf_file_id: "reading/books/book-1/old.pdf", cover_file_id: "reading/books/book-1/old.webp",
    });
    await expect(manager.permanentDeleteBook("book-1")).rejects.toThrow("回收站");
    expect(permanentlyDeleted()).toBe(false);
    expect(cleanup.size).toBe(0);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("persists both attachment paths before permanently deleting a soft-deleted book and retries failures", async () => {
    const { manager, blob, cleanup, permanentlyDeleted } = setup({
      id: "book-1", title: "Cloud book", deleted_at: "2026-08-17T00:00:00.000Z",
      pdf_file_id: "reading/books/book-1/old.pdf", cover_file_id: "reading/books/book-1/old.webp",
    });
    vi.mocked(blob.del).mockRejectedValue(new Error("Blob unavailable"));
    await manager.permanentDeleteBook("book-1");
    expect(permanentlyDeleted()).toBe(true);
    expect([...cleanup.keys()].sort()).toEqual([
      "reading/books/book-1/old.pdf",
      "reading/books/book-1/old.webp",
    ]);
    vi.mocked(blob.del).mockResolvedValue(undefined);
    await manager.retryPendingCleanup();
    expect(cleanup.size).toBe(0);
  });

  it("reads PDF and cover only through private Blob access", async () => {
    const { manager, blob } = setup();
    await manager.readPdf("book-1");
    await manager.readCover("book-1");
    expect(blob.get).toHaveBeenNthCalledWith(1, "reading/books/book-1/old.pdf", { access: "private" });
    expect(blob.get).toHaveBeenNthCalledWith(2, "reading/books/book-1/old.webp", { access: "private" });
  });
});
