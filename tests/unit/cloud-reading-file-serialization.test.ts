// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CloudReadingFileManager, type CloudBlobClient } from "../../server/cloud/reading-files.js";
import { NotFoundError } from "../../server/errors.js";
import type { Entity } from "../../server/store.js";

type CleanupState = "pending" | "claimed" | "deleted";
type Cleanup = { pathname: string; reason: string; attempts: number; last_error: string | null; state: CleanupState };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
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

function setup(
  initialBook: Entity = { id: "book-1", title: "Serialized book", deleted_at: null },
  enforceBookFirst = false,
) {
  let book: Entity | null = { ...initialBook };
  const cleanup = new Map<string, Cleanup>();
  const mutex = new PathMutex();
  const bookMutex = new PathMutex();
  const lockCalls: string[] = [];
  let throwAfterCommit = false;
  let nextBookReadPause: { acquired: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
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
    let bookLocked = false;
    const tx = {
      ...store,
      getForUpdate: vi.fn(async (...args: [string, string, boolean?]) => {
        if (!bookLocked) {
          releases.push(await bookMutex.acquire(`book:${args[1]}`));
          bookLocked = true;
          if (nextBookReadPause) {
            const pause = nextBookReadPause;
            nextBookReadPause = null;
            pause.acquired.resolve();
            await pause.release.promise;
          }
        }
        return store.getForUpdate(...args);
      }),
      lockBlobPath: vi.fn(async (pathname: string) => {
        if (enforceBookFirst && !bookLocked) throw new Error("path lock acquired before book row lock");
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
    pauseNextBookRead: () => {
      const pause = { acquired: deferred(), release: deferred() };
      nextBookReadPause = pause;
      return pause;
    },
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

  it("serializes a duplicate callback and PDF removal in book-then-path order", async () => {
    const { manager, book, pauseNextBookRead } = setup({
      id: "book-1", title: "Serialized book", deleted_at: null,
      pdf_file_id: pathname, pdf_filename: "book.pdf",
    }, true);
    const pause = pauseNextBookRead();
    const completionResult = manager.completeUpload(completion).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ status: "rejected" as const, error }),
    );
    const acquiredBookFirst = await Promise.race([
      pause.acquired.promise.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    expect(acquiredBookFirst).toBe(true);

    const removal = manager.removePdf("book-1");
    pause.release.resolve();
    const [completedResult, removed] = await Promise.all([completionResult, removal]);
    expect(completedResult.status).toBe("fulfilled");
    expect(removed.pdf_file_id).toBeNull();
    expect(book().pdf_file_id).toBeNull();
  });

  it("claims cleanup in book-then-path order", async () => {
    const { manager, store, cleanup } = setup(undefined, true);
    await store.enqueueBlobCleanup(pathname, "upload-metadata-failed");
    await manager.retryPendingCleanup();
    expect(cleanup.get(pathname)?.state).toBe("deleted");
  });
});
