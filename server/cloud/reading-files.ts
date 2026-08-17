import path from "node:path";
import { del, get, put } from "@vercel/blob";
import { ReadingValidationError } from "../reading.js";
import type { Entity } from "../store.js";

type BlobPutOptions = {
  access: "private";
  addRandomSuffix: true;
  contentType: string;
};

type BlobReadResult = {
  body: ReadableStream<Uint8Array>;
  contentType: string;
};

export type CloudBlobClient = {
  put(pathname: string, content: Buffer, options: BlobPutOptions): Promise<{ pathname: string; contentType: string }>;
  get(pathname: string, options: { access: "private" }): Promise<BlobReadResult | null>;
  del(pathname: string): Promise<void>;
};

type ReadingFileStore = {
  get(collection: "books", id: string, includeDeleted?: boolean): Promise<Entity>;
  update(collection: "books", id: string, input: Entity): Promise<Entity>;
};

export const vercelBlobClient: CloudBlobClient = {
  put: async (pathname, content, options) => put(pathname, content, options),
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

  async savePdf(bookId: string, content: Buffer, originalName: string): Promise<Entity> {
    if (content.byteLength > 100 * 1024 * 1024) throw new ReadingValidationError("PDF 文件不能超过 100 MB");
    if (content.byteLength < 5 || content.subarray(0, 5).toString("ascii") !== "%PDF-") {
      throw new ReadingValidationError("请选择有效的 PDF 文件");
    }
    const book = await this.store.get("books", bookId);
    const uploaded = await this.blob.put(`reading/books/${bookId}/book.pdf`, content, {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/pdf",
    });
    let updated: Entity;
    try {
      updated = await this.store.update("books", bookId, {
        pdf_file_id: uploaded.pathname,
        pdf_filename: safeDisplayName(originalName, "book.pdf"),
      });
    } catch (error) {
      await this.blob.del(uploaded.pathname).catch(() => undefined);
      throw error;
    }
    if (book.pdf_file_id && book.pdf_file_id !== uploaded.pathname) await this.deleteReadingBlob(String(book.pdf_file_id));
    return updated;
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
    const book = await this.store.get("books", bookId);
    const updated = await this.store.update("books", bookId, { pdf_file_id: null, pdf_filename: null });
    if (book.pdf_file_id) await this.deleteReadingBlob(String(book.pdf_file_id));
    return updated;
  }

  async saveCover(bookId: string, content: Buffer, contentType: string, originalName: string): Promise<Entity> {
    if (content.byteLength > 10 * 1024 * 1024) throw new ReadingValidationError("封面图片不能超过 10 MB");
    const extension = detectImage(content, contentType);
    if (!extension) throw new ReadingValidationError("请选择 PNG、JPEG 或 WebP 封面图片");
    const book = await this.store.get("books", bookId);
    const uploaded = await this.blob.put(`reading/books/${bookId}/cover.${extension}`, content, {
      access: "private",
      addRandomSuffix: true,
      contentType,
    });
    let updated: Entity;
    try {
      updated = await this.store.update("books", bookId, {
        cover_file_id: uploaded.pathname,
        cover_filename: safeDisplayName(originalName, `cover.${extension}`),
      });
    } catch (error) {
      await this.blob.del(uploaded.pathname).catch(() => undefined);
      throw error;
    }
    if (book.cover_file_id && book.cover_file_id !== uploaded.pathname) await this.deleteReadingBlob(String(book.cover_file_id));
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
    const book = await this.store.get("books", bookId);
    const updated = await this.store.update("books", bookId, { cover_file_id: null, cover_filename: null });
    if (book.cover_file_id) await this.deleteReadingBlob(String(book.cover_file_id));
    return updated;
  }

  async removeBookFiles(book: Entity): Promise<void> {
    const pathnames = [book.pdf_file_id, book.cover_file_id]
      .filter((value): value is string => typeof value === "string")
      .map((value) => this.readingPath(value));
    if (pathnames.length) await Promise.all(pathnames.map((pathname) => this.blob.del(pathname)));
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

  private async deleteReadingBlob(pathname: string): Promise<void> {
    await this.blob.del(this.readingPath(pathname));
  }
}

function detectImage(content: Buffer, contentType: string): "png" | "jpg" | "webp" | null {
  if (content.length >= 8 && content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && contentType === "image/png") return "png";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff && contentType === "image/jpeg") return "jpg";
  if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP" && contentType === "image/webp") return "webp";
  return null;
}

function safeDisplayName(value: string | undefined, fallback: string): string {
  const name = path.basename(value || fallback).replace(/[\r\n"]/g, "").trim();
  return name || fallback;
}
