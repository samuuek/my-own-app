// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudReadingFileManager, type CloudBlobClient } from "../../server/cloud/reading-files.js";
import type { Entity } from "../../server/store.js";

function stream(text = "content"): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close(); } });
}

function setup(book: Entity = { id: "book-1", title: "Cloud book", pdf_file_id: "reading/books/book-1/old.pdf", cover_file_id: "reading/books/book-1/old.webp" }) {
  let current = { ...book };
  const events: string[] = [];
  const store = {
    get: vi.fn(async () => ({ ...current })),
    update: vi.fn(async (_collection: string, _id: string, input: Entity) => {
      events.push("database");
      current = { ...current, ...input };
      return { ...current };
    }),
  };
  const blob: CloudBlobClient = {
    put: vi.fn(async (pathname, _content, options) => {
      events.push("upload");
      return { pathname: `${pathname.replace(/\.[^.]+$/, "")}-random${pathname.match(/\.[^.]+$/)?.[0] ?? ""}`, contentType: options.contentType ?? "application/octet-stream" };
    }),
    get: vi.fn(async (pathname) => ({ body: stream(), contentType: pathname.endsWith(".pdf") ? "application/pdf" : "image/webp" })),
    del: vi.fn(async () => { events.push("delete"); }),
  };
  return { manager: new CloudReadingFileManager(store, blob), store, blob, events, current: () => current };
}

describe("CloudReadingFileManager", () => {
  it("rejects invalid and oversized PDFs before uploading", async () => {
    const { manager, blob } = setup();
    await expect(manager.savePdf("book-1", Buffer.from("not a pdf"), "notes.pdf")).rejects.toThrow("有效的 PDF");
    await expect(manager.savePdf("book-1", Buffer.alloc(100 * 1024 * 1024 + 1), "large.pdf")).rejects.toThrow("100 MB");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it.each([
    ["image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "png"],
    ["image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0x00]), "jpg"],
    ["image/webp", Buffer.from("RIFFxxxxWEBP", "ascii"), "webp"],
  ])("accepts a real %s cover and stores it privately", async (contentType, content, extension) => {
    const { manager, blob } = setup({ id: "book-1", title: "Cloud book" });
    await manager.saveCover("book-1", content, contentType, "cover-image");
    expect(blob.put).toHaveBeenCalledWith(
      `reading/books/book-1/cover.${extension}`,
      content,
      expect.objectContaining({ access: "private", addRandomSuffix: true, contentType }),
    );
  });

  it("rejects mismatched or oversized covers before uploading", async () => {
    const { manager, blob } = setup();
    await expect(manager.saveCover("book-1", Buffer.from("RIFFxxxxWEBP"), "image/png", "cover.png")).rejects.toThrow("PNG、JPEG 或 WebP");
    await expect(manager.saveCover("book-1", Buffer.alloc(10 * 1024 * 1024 + 1), "image/png", "large.png")).rejects.toThrow("10 MB");
    expect(blob.put).not.toHaveBeenCalled();
  });

  it("uploads privately, saves the returned pathname, then deletes the old PDF", async () => {
    const { manager, store, blob, events } = setup();
    const pdf = Buffer.from("%PDF-1.7\ncloud", "ascii");
    const saved = await manager.savePdf("book-1", pdf, "../cloud\r\n.pdf");
    expect(blob.put).toHaveBeenCalledWith("reading/books/book-1/book.pdf", pdf, {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/pdf",
    });
    expect(store.update).toHaveBeenCalledWith("books", "book-1", {
      pdf_file_id: "reading/books/book-1/book-random.pdf",
      pdf_filename: "cloud.pdf",
    });
    expect(blob.del).toHaveBeenCalledWith("reading/books/book-1/old.pdf");
    expect(events).toEqual(["upload", "database", "delete"]);
    expect(saved.pdf_file_id).toBe("reading/books/book-1/book-random.pdf");
  });

  it("removes a newly uploaded blob when saving its metadata fails", async () => {
    const { manager, store, blob } = setup();
    vi.mocked(store.update).mockRejectedValueOnce(new Error("database unavailable"));
    await expect(manager.savePdf("book-1", Buffer.from("%PDF-1.7"), "cloud.pdf")).rejects.toThrow("database unavailable");
    expect(blob.del).toHaveBeenCalledWith("reading/books/book-1/book-random.pdf");
    expect(blob.del).not.toHaveBeenCalledWith("reading/books/book-1/old.pdf");
  });

  it("never deletes the newly saved blob when old-blob cleanup fails", async () => {
    const { manager, blob, current } = setup();
    vi.mocked(blob.del).mockRejectedValueOnce(new Error("old blob cleanup failed"));
    await expect(manager.savePdf("book-1", Buffer.from("%PDF-1.7"), "cloud.pdf")).rejects.toThrow("old blob cleanup failed");
    expect(blob.del).toHaveBeenCalledTimes(1);
    expect(blob.del).toHaveBeenCalledWith("reading/books/book-1/old.pdf");
    expect(current().pdf_file_id).toBe("reading/books/book-1/book-random.pdf");
  });

  it("clears PDF metadata before deleting the private blob", async () => {
    const { manager, blob, events, current } = setup();
    const result = await manager.removePdf("book-1");
    expect(events).toEqual(["database", "delete"]);
    expect(blob.del).toHaveBeenCalledWith("reading/books/book-1/old.pdf");
    expect(current()).toMatchObject({ pdf_file_id: null, pdf_filename: null });
    expect(result.pdf_file_id).toBeNull();
  });

  it("reads private PDF and cover streams through the injected client", async () => {
    const { manager, blob } = setup();
    const pdf = await manager.readPdf("book-1");
    const cover = await manager.readCover("book-1");
    expect(blob.get).toHaveBeenNthCalledWith(1, "reading/books/book-1/old.pdf", { access: "private" });
    expect(blob.get).toHaveBeenNthCalledWith(2, "reading/books/book-1/old.webp", { access: "private" });
    expect(pdf.contentType).toBe("application/pdf");
    expect(cover.contentType).toBe("image/webp");
  });
});
