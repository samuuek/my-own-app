// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudReadingFileManager, type CloudBlobClient } from "../../server/cloud/reading-files.js";
import type { Entity } from "../../server/store.js";

function stream(text = "content"): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

type Cleanup = { pathname: string; reason: string; attempts: number; last_error: string | null };

function setup(book: Entity = {
  id: "book-1", title: "Cloud book",
  pdf_file_id: "reading/books/book-1/old.pdf",
  cover_file_id: "reading/books/book-1/old.webp",
}) {
  let current = { ...book };
  let permanentlyDeleted = false;
  const cleanup = new Map<string, Cleanup>();
  const store: any = {
    get: vi.fn(async () => ({ ...current })),
    getForUpdate: vi.fn(async () => ({ ...current })),
    update: vi.fn(async (_collection: string, _id: string, input: Entity) => {
      current = { ...current, ...input };
      return { ...current };
    }),
    permanentDelete: vi.fn(async () => { permanentlyDeleted = true; }),
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
    get: vi.fn(async (pathname) => ({ body: stream(), contentType: pathname.endsWith(".pdf") ? "application/pdf" : "image/webp" })),
    del: vi.fn(async () => undefined),
  };
  return {
    manager: new CloudReadingFileManager(store, blob), store, blob, cleanup,
    current: () => current, permanentlyDeleted: () => permanentlyDeleted,
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

    await expect(manager.completeUpload({
      blob: { pathname: "exports/stolen.zip", contentType: "application/pdf" },
      tokenPayload: uploadPayload("pdf", "application/pdf", "Cloud book.pdf"),
    })).rejects.toThrow("上传路径无效");
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

  it("persists both attachment paths before permanently deleting a book and retries failures", async () => {
    const { manager, blob, cleanup, permanentlyDeleted } = setup();
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
