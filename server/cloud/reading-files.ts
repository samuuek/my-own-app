import path from "node:path";
import { del, get } from "@vercel/blob";
import { NotFoundError } from "../errors.js";
import { ReadingValidationError } from "../reading.js";
import type { Entity } from "../store.js";

type BlobReadResult = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export type CloudBlobClient = {
  get(pathname: string, options: { access: "private" }): Promise<BlobReadResult | null>;
  del(pathname: string): Promise<void>;
};

type CleanupRecord = {
  pathname: string;
  reason: string;
  state: "pending" | "claimed" | "deleted";
  attempts: number;
  last_error: string | null;
};

type ReadingFileStore = {
  get(collection: "books", id: string, includeDeleted?: boolean): Promise<Entity>;
  getForUpdate(collection: "books", id: string, includeDeleted?: boolean): Promise<Entity>;
  update(collection: "books", id: string, input: Entity): Promise<Entity>;
  permanentDelete(collection: "books", id: string): Promise<boolean>;
  transaction<T>(work: (store: ReadingFileStore) => Promise<T>): Promise<T>;
  lockBlobPath(pathname: string): Promise<void>;
  enqueueBlobCleanup(pathname: string, reason: string): Promise<void>;
  listBlobCleanup(limit?: number): Promise<CleanupRecord[]>;
  getBlobCleanupForUpdate(pathname: string): Promise<CleanupRecord | null>;
  claimBlobCleanup(pathname: string): Promise<boolean>;
  cancelBlobCleanup(pathname: string): Promise<void>;
  completeBlobCleanup(pathname: string): Promise<void>;
  failBlobCleanup(pathname: string, message: string): Promise<void>;
};

type UploadKind = "pdf" | "cover";
type UploadPayload = {
  bookId: string;
  kind: UploadKind;
  contentType: string;
  originalName: string;
};

type CompletedUpload = {
  blob: { pathname: string; contentType: string };
  tokenPayload?: string | null;
};

const PDF_LIMIT = 100 * 1024 * 1024;
const COVER_LIMIT = 10 * 1024 * 1024;
const coverExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

export const vercelBlobClient: CloudBlobClient = {
  get: async (pathname, options) => {
    const result = await get(pathname, options);
    if (!result || result.statusCode !== 200) return null;
    return { body: result.stream, contentType: result.blob.contentType };
  },
  del: async (pathname) => del(pathname),
};

export class CloudReadingFileManager {
  constructor(
    private readonly store: ReadingFileStore,
    private readonly blob: CloudBlobClient = vercelBlobClient,
  ) {}

  async authorizeUpload(pathname: string, clientPayload: string | null, multipart: boolean) {
    void multipart;
    const payload = parseUploadPayload(clientPayload);
    await this.store.get("books", payload.bookId);
    const expected = requestedPath(payload);
    if (pathname !== expected) throw new ReadingValidationError("上传路径无效");
    return {
      allowedContentTypes: [payload.contentType],
      maximumSizeInBytes: payload.kind === "pdf" ? PDF_LIMIT : COVER_LIMIT,
      addRandomSuffix: true as const,
      tokenPayload: JSON.stringify(payload),
    };
  }

  async completeUpload({ blob, tokenPayload }: CompletedUpload): Promise<void> {
    const payload = parseUploadPayload(tokenPayload ?? null);
    const uploadedPath = this.completedPath(payload, blob.pathname, blob.contentType);
    try {
      await this.validateUploadedContent(payload, uploadedPath);
    } catch (error) {
      await this.queueRejectedUpload(uploadedPath, "invalid-upload");
      throw error;
    }
    try {
      await this.store.transaction(async (store) => {
        await store.lockBlobPath(uploadedPath);
        const cleanup = await store.getBlobCleanupForUpdate(uploadedPath);
        if (cleanup?.state === "claimed" || cleanup?.state === "deleted") {
          throw new ReadingValidationError("上传文件已失效，请重新上传");
        }
        if (cleanup?.state === "pending") await store.cancelBlobCleanup(uploadedPath);
        const book = await store.getForUpdate("books", payload.bookId);
        const field = payload.kind === "pdf" ? "pdf_file_id" : "cover_file_id";
        const filenameField = payload.kind === "pdf" ? "pdf_filename" : "cover_filename";
        const oldPath = book[field];
        if (oldPath === uploadedPath) return;
        if (typeof oldPath === "string" && oldPath !== uploadedPath) {
          await store.enqueueBlobCleanup(oldPath, payload.kind === "pdf" ? "replace-pdf" : "replace-cover");
        }
        await store.update("books", payload.bookId, {
          [field]: uploadedPath,
          [filenameField]: payload.originalName,
        });
      });
    } catch (error) {
      await this.queueRejectedUpload(uploadedPath, "upload-metadata-failed");
      throw error;
    }
    await this.retryPendingCleanup();
  }

  async readPdf(bookId: string): Promise<{ book: Entity; body: ReadableStream<Uint8Array>; contentType: string }> {
    const book = await this.store.get("books", bookId);
    if (!book.pdf_file_id) throw new ReadingValidationError("这本书还没有上传 PDF");
    const pathname = this.bookPath(bookId, String(book.pdf_file_id));
    const result = await this.blob.get(pathname, { access: "private" });
    if (!result) throw new ReadingValidationError("PDF 文件缺失，请重新上传");
    return { book, body: result.body, contentType: "application/pdf" };
  }

  async removePdf(bookId: string): Promise<Entity> {
    const updated = await this.store.transaction(async (store) => {
      const book = await store.getForUpdate("books", bookId);
      if (typeof book.pdf_file_id === "string") await store.enqueueBlobCleanup(book.pdf_file_id, "remove-pdf");
      return store.update("books", bookId, { pdf_file_id: null, pdf_filename: null });
    });
    await this.retryPendingCleanup();
    return updated;
  }

  async readCover(bookId: string): Promise<{ body: ReadableStream<Uint8Array>; contentType: string }> {
    const book = await this.store.get("books", bookId);
    if (!book.cover_file_id) throw new ReadingValidationError("这本书还没有上传封面");
    const pathname = this.bookPath(bookId, String(book.cover_file_id));
    const result = await this.blob.get(pathname, { access: "private" });
    if (!result) throw new ReadingValidationError("封面文件缺失，请重新上传");
    return result;
  }

  async removeCover(bookId: string): Promise<Entity> {
    const updated = await this.store.transaction(async (store) => {
      const book = await store.getForUpdate("books", bookId);
      if (typeof book.cover_file_id === "string") await store.enqueueBlobCleanup(book.cover_file_id, "remove-cover");
      return store.update("books", bookId, { cover_file_id: null, cover_filename: null });
    });
    await this.retryPendingCleanup();
    return updated;
  }

  async permanentDeleteBook(bookId: string): Promise<void> {
    await this.store.transaction(async (store) => {
      const book = await store.getForUpdate("books", bookId, true);
      if (!book.deleted_at) throw new ReadingValidationError("请先将书籍移入回收站，再永久删除");
      const deleted = await store.permanentDelete("books", bookId);
      if (!deleted) throw new NotFoundError("没有找到可永久删除的书籍");
      if (typeof book.pdf_file_id === "string") await store.enqueueBlobCleanup(book.pdf_file_id, "delete-book-pdf");
      if (typeof book.cover_file_id === "string") await store.enqueueBlobCleanup(book.cover_file_id, "delete-book-cover");
    });
    await this.retryPendingCleanup();
  }

  async retryPendingCleanup(limit = 20): Promise<void> {
    const records = await this.store.listBlobCleanup(limit);
    for (const record of records) {
      const pathname = this.readingPath(record.pathname);
      const bookId = pathname.split("/")[2];
      let claimed: boolean;
      try {
        claimed = await this.store.transaction(async (store) => {
          await store.lockBlobPath(pathname);
          const cleanup = await store.getBlobCleanupForUpdate(pathname);
          if (!cleanup || cleanup.state === "deleted") return false;
          if (await this.isCurrentAttachment(store, bookId, pathname)) {
            await store.cancelBlobCleanup(pathname);
            return false;
          }
          return store.claimBlobCleanup(pathname);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Blob cleanup claim failed";
        await this.store.failBlobCleanup(pathname, message.slice(0, 500));
        continue;
      }
      if (!claimed) continue;
      try {
        await this.blob.del(pathname);
        await this.store.transaction(async (store) => {
          await store.lockBlobPath(pathname);
          await store.completeBlobCleanup(pathname);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Blob cleanup failed";
        await this.store.transaction(async (store) => {
          await store.lockBlobPath(pathname);
          await store.failBlobCleanup(pathname, message.slice(0, 500));
        });
      }
    }
  }

  private async validateUploadedContent(payload: UploadPayload, pathname: string): Promise<void> {
    let result: BlobReadResult | null;
    try {
      result = await this.blob.get(pathname, { access: "private" });
    } catch {
      throw new ReadingValidationError("无法验证上传文件，请重新上传");
    }
    if (!result || result.contentType !== payload.contentType) {
      throw new ReadingValidationError("无法验证上传文件，请重新上传");
    }
    let prefix: Uint8Array;
    try {
      prefix = await readPrefix(result.body, 12);
    } catch {
      throw new ReadingValidationError("无法验证上传文件，请重新上传");
    }
    if (payload.kind === "pdf") {
      if (!startsWith(prefix, [0x25, 0x50, 0x44, 0x46, 0x2d])) throw new ReadingValidationError("请选择有效的 PDF 文件");
      return;
    }
    const valid = payload.contentType === "image/png"
      ? startsWith(prefix, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : payload.contentType === "image/jpeg"
        ? startsWith(prefix, [0xff, 0xd8, 0xff])
        : startsWith(prefix, [0x52, 0x49, 0x46, 0x46]) && matchesAt(prefix, 8, [0x57, 0x45, 0x42, 0x50]);
    if (!valid) throw new ReadingValidationError("请选择 PNG、JPEG 或 WebP 封面图片");
  }

  private async queueRejectedUpload(pathname: string, reason: string): Promise<void> {
    await this.store.enqueueBlobCleanup(pathname, reason);
    await this.retryPendingCleanup();
  }

  private async isCurrentAttachment(store: ReadingFileStore, bookId: string, pathname: string): Promise<boolean> {
    try {
      const book = await store.get("books", bookId, true);
      return book.pdf_file_id === pathname || book.cover_file_id === pathname;
    } catch (error) {
      if (error instanceof NotFoundError) return false;
      throw error;
    }
  }

  private completedPath(payload: UploadPayload, pathname: string, contentType: string): string {
    if (contentType !== payload.contentType) throw new ReadingValidationError("上传文件类型无效");
    const requested = requestedPath(payload);
    const extension = requested.slice(requested.lastIndexOf("."));
    const stem = requested.slice(0, -extension.length);
    const escapedStem = escapeRegExp(stem);
    const escapedExtension = escapeRegExp(extension);
    if (!new RegExp(`^${escapedStem}(?:-[A-Za-z0-9]+)?${escapedExtension}$`).test(pathname)) {
      throw new ReadingValidationError("上传路径无效");
    }
    return this.bookPath(payload.bookId, pathname);
  }

  private bookPath(bookId: string, pathname: string): string {
    const safe = this.readingPath(pathname);
    if (!safe.startsWith(`reading/books/${bookId}/`)) throw new ReadingValidationError("附件路径无效");
    return safe;
  }

  private readingPath(pathname: string): string {
    if (!pathname.startsWith("reading/books/") || pathname.includes("..") || pathname.includes("\\")) {
      throw new ReadingValidationError("附件路径无效");
    }
    return pathname;
  }
}

function requestedPath(payload: UploadPayload): string {
  if (payload.kind === "pdf") return `reading/books/${payload.bookId}/book.pdf`;
  return `reading/books/${payload.bookId}/cover.${coverExtensions.get(payload.contentType)}`;
}

function parseUploadPayload(value: string | null): UploadPayload {
  let parsed: unknown;
  try {
    parsed = value ? JSON.parse(value) : null;
  } catch {
    throw new ReadingValidationError("上传信息无效");
  }
  if (!parsed || typeof parsed !== "object") throw new ReadingValidationError("上传信息无效");
  const input = parsed as Record<string, unknown>;
  const bookId = typeof input.bookId === "string" ? input.bookId.trim() : "";
  const kind = input.kind;
  const contentType = typeof input.contentType === "string" ? input.contentType : "";
  if (!bookId || bookId.includes("/") || bookId.includes("\\") || bookId.includes("..")) {
    throw new ReadingValidationError("上传信息无效");
  }
  if (kind !== "pdf" && kind !== "cover") throw new ReadingValidationError("上传信息无效");
  if (kind === "pdf" && contentType !== "application/pdf") throw new ReadingValidationError("请选择有效的 PDF 文件");
  if (kind === "cover" && !coverExtensions.has(contentType)) throw new ReadingValidationError("请选择 PNG、JPEG 或 WebP 封面图片");
  const fallback = kind === "pdf" ? "book.pdf" : `cover.${coverExtensions.get(contentType)}`;
  return {
    bookId,
    kind,
    contentType,
    originalName: safeDisplayName(typeof input.originalName === "string" ? input.originalName : undefined, fallback),
  };
}

function safeDisplayName(value: string | undefined, fallback: string): string {
  const name = path.basename(value || fallback).replace(/[\r\n"]/g, "").trim();
  return name || fallback;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readPrefix(body: ReadableStream<Uint8Array>, length: number): Promise<Uint8Array> {
  const reader = body.getReader();
  const prefix = new Uint8Array(length);
  let offset = 0;
  try {
    while (offset < length) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, length - offset);
      prefix.set(value.subarray(0, take), offset);
      offset += take;
    }
    return prefix.subarray(0, offset);
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function startsWith(value: Uint8Array, expected: number[]): boolean {
  return matchesAt(value, 0, expected);
}

function matchesAt(value: Uint8Array, offset: number, expected: number[]): boolean {
  return value.byteLength >= offset + expected.length
    && expected.every((byte, index) => value[offset + index] === byte);
}
