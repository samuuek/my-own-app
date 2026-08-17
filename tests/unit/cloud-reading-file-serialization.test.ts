// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudReadingFileManager, type CloudBlobClient } from "../../server/cloud/reading-files.js";
import { NotFoundError } from "../../server/errors.js";
import type { Entity } from "../../server/store.js";

type CleanupState = "pending" | "claimed" | "deleted";
type Cleanup = { pathname: string; reason: string; attempts: number; last_error: string | null; state: CleanupState };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

class PathMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(pathname: string): Promise<() => void> {
    const previous = this.tails.get(pathname) ?? Promise.resolve();
    const released = deferred();
    this.tails.set(pathname, previous.then(() => released.promise));
    await previous;
    return () => released.resolve();
  }
}

function pdfStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("%PDF-1.7\n"));
      controller.close();
    },
  });
}

function setup() {
  let book: Entity | null = { id: "book-1", title: "Serialized book", deleted_at: null };
  const cleanup = new Map<string, Cleanup>();
  const mutex = new PathMutex();
  const lockCalls: string[] = [];
  let throwAfterCommit = false;
  const store: any = {
    get: vi.fn(async () => {
      if (!book) throw new NotFoundError("missing book");
      return { ...book };
    }),
    getForUpdate: vi.fn(async () => {
      if (!book || book.deleted_at) throw new NotFoundError("missing active book");
      return { ...book };
    }),
    update: vi.fn(async (_collection: string, _id: string, input: Entity) => {
      if (!book) throw new NotFoundError("missing book");
      book = { ...book, ...input };
      return { ...book };
    }),
    permanentDelete: vi.fn(async () => false),
    enqueueBlobCleanup: vi.fn(async (pathname: string, reason: string) => {
      const existing = cleanup.get(pathname);
      if (existing && existing.state !== "pending") return;
      cleanup.set(pathname, { pathname, reason, attempts: existing?.attempts ?? 0, last_error: null, state: "pending" });
    }),
    listBlobCleanup: vi.fn(async () => [...cleanup.values()].filter((row) => row.state !== "deleted")),
    getBlobCleanupForUpdate: vi.fn(async (pathname: string) => cleanup.get(pathname) ?? null),
    claimBlobCleanup: vi.fn(async (pathname: string) => {
      const row = cleanup.get(pathname);
      if (!row || row.state !== "pending") return false;
      cleanup.set(pathname, { ...row, state: "claimed" });
      return true;
    }),
    cancelBlobCleanup: vi.fn(async (pathname: string) => { cleanup.delete(pathname); }),
    completeBlobCleanup: vi.fn(async (pathname: string) => {
      const row = cleanup.get(pathname);
      if (row) cleanup.set(pathname, { ...row, state: "deleted" });
    }),
    failBlobCleanup: vi.fn(async (pathname: string, message: string) => {
      const row = cleanup.get(pathname)!;
      cleanup.set(pathname, { ...row, state: "claimed", attempts: row.attempts + 1, last_error: message });
    }),
  };
  store.transaction = vi.fn(async (work: (tx: any) => Promise<any>) => {
    const releases: Array<() => void> = [];
    const tx = {
      ...store,
      lockBlobPath: vi.fn(async (pathname: string) => {
        lockCalls.push(pathname);
        releases.push(await mutex.acquire(pathname));
      }),
    };
    try {
      const result = await work(tx);
      if (throwAfterCommit) {
        throwAfterCommit = false;
        throw new Error("commit visibility was ambiguous");
      }
      return result;
    } finally {
      releases.reverse().forEach((release) => release());
    }
  });
  const blob: CloudBlobClient = {
    get: vi.fn(async () => ({ body: pdfStream(), contentType: "application/pdf" })),
    del: vi.fn(async () => undefined),
  };
  return {
    manager: new CloudReadingFileManager(store, blob), store, blob, cleanup, lockCalls,
    book: () => book as Entity,
    makeCommitAmbiguous: () => { throwAfterCommit = true; },
  };
}

const pathname = "reading/books/book-1/book-serialized.pdf";
const tokenPayload = JSON.stringify({ bookId: "book-1", kind: "pdf", contentType: "application/pdf", originalName: "book.pdf" });
const completion = { blob: { pathname, contentType: "application/pdf" }, tokenPayload };

describe("serialized Blob completion and cleanup", () => {
  it("prevents a callback retry from committing after cleanup has claimed the pathname", async () => {
    const { manager, store, blob, cleanup, book } = setup();
    await store.enqueueBlobCleanup(pathname, "upload-metadata-failed");
    const deleting = deferred();
    const allowDelete = deferred();
    vi.mocked(blob.del).mockImplementationOnce(async () => {
      deleting.resolve();
      await allowDelete.promise;
    });

    const cleanupRun = manager.retryPendingCleanup();
    await deleting.promise;
    expect(cleanup.get(pathname)?.state).toBe("claimed");
    await expect(manager.completeUpload(completion)).rejects.toThrow("失效");
    expect(book().pdf_file_id).toBeUndefined();
    allowDelete.resolve();
    await cleanupRun;
    expect(cleanup.get(pathname)?.state).toBe("deleted");
  });

  it("lets a callback holding the pathname lock cancel cleanup before metadata commit", async () => {
    const { manager, store, blob, book } = setup();
    await store.enqueueBlobCleanup(pathname, "upload-metadata-failed");
    const updating = deferred();
    const allowUpdate = deferred();
    store.update.mockImplementationOnce(async (_collection: string, _id: string, input: Entity) => {
      updating.resolve();
      await allowUpdate.promise;
      Object.assign(book(), input);
      return { ...book() };
    });

    const completing = manager.completeUpload(completion);
    await updating.promise;
    const cleanupRun = manager.retryPendingCleanup();
    allowUpdate.resolve();
    await completing;
    await cleanupRun;
    expect(book().pdf_file_id).toBe(pathname);
    expect(blob.del).not.toHaveBeenCalled();
  });

  it("resolves an ambiguous commit only after reacquiring the same pathname lock", async () => {
    const { manager, blob, book, lockCalls, makeCommitAmbiguous } = setup();
    makeCommitAmbiguous();
    await expect(manager.completeUpload(completion)).rejects.toThrow("ambiguous");
    expect(book().pdf_file_id).toBe(pathname);
    expect(blob.del).not.toHaveBeenCalled();
    expect(lockCalls.filter((value) => value === pathname).length).toBeGreaterThanOrEqual(2);
  });

  it("handles duplicate completion callbacks idempotently", async () => {
    const { manager, store, blob, book } = setup();
    await manager.completeUpload(completion);
    await manager.completeUpload(completion);
    expect(book().pdf_file_id).toBe(pathname);
    expect(store.update).toHaveBeenCalledTimes(1);
    expect(blob.del).not.toHaveBeenCalledWith(pathname);
  });
});
