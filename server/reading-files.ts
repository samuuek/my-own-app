import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppPaths } from "./config.js";
import type { AppStore, Entity } from "./store.js";
import { ReadingValidationError } from "./reading.js";

export class ReadingFileManager {
  constructor(private readonly paths: AppPaths, private readonly store: AppStore) {}

  savePdf(bookId: string, content: Buffer, originalName: string): Entity {
    if (content.byteLength > 100 * 1024 * 1024) throw new ReadingValidationError("PDF 文件不能超过 100 MB");
    if (content.byteLength < 5 || content.subarray(0, 5).toString("ascii") !== "%PDF-") throw new ReadingValidationError("请选择有效的 PDF 文件");
    const book = this.store.get("books", bookId);
    const fileId = `${randomUUID()}.pdf`;
    const target = this.safePath(fileId);
    const temporary = `${target}.partial`;
    try {
      fs.writeFileSync(temporary, content);
      fs.renameSync(temporary, target);
      const updated = this.store.update("books", bookId, { pdf_file_id: fileId, pdf_filename: safeDisplayName(originalName, "book.pdf") });
      if (book.pdf_file_id && book.pdf_file_id !== fileId) this.removeFile(book.pdf_file_id);
      return updated;
    } catch (error) {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      if (fs.existsSync(target) && this.store.get("books", bookId, true).pdf_file_id !== fileId) fs.unlinkSync(target);
      throw error;
    }
  }

  resolvePdf(bookId: string): { book: Entity; path: string } {
    const book = this.store.get("books", bookId);
    if (!book.pdf_file_id) throw new ReadingValidationError("这本书还没有上传 PDF");
    const file = this.safePath(book.pdf_file_id);
    if (!fs.existsSync(file)) throw new ReadingValidationError("PDF 文件缺失，请重新上传");
    return { book, path: file };
  }

  removePdf(bookId: string): Entity {
    const book = this.store.get("books", bookId);
    if (book.pdf_file_id) this.removeFile(book.pdf_file_id);
    return this.store.update("books", bookId, { pdf_file_id: null, pdf_filename: null });
  }

  saveCover(bookId: string, content: Buffer, contentType: string, originalName: string): Entity {
    if (content.byteLength > 10 * 1024 * 1024) throw new ReadingValidationError("封面图片不能超过 10 MB");
    const extension = detectImage(content, contentType);
    if (!extension) throw new ReadingValidationError("请选择 PNG、JPEG 或 WebP 封面图片");
    const book = this.store.get("books", bookId);
    const fileId = `${randomUUID()}.${extension}`;
    const target = this.safePath(fileId);
    fs.writeFileSync(`${target}.partial`, content);
    fs.renameSync(`${target}.partial`, target);
    try {
      const updated = this.store.update("books", bookId, { cover_file_id: fileId, cover_filename: safeDisplayName(originalName, `cover.${extension}`) });
      if (book.cover_file_id && book.cover_file_id !== fileId) this.removeFile(book.cover_file_id);
      return updated;
    } catch (error) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
      throw error;
    }
  }

  resolveCover(bookId: string): { path: string; contentType: string } {
    const book = this.store.get("books", bookId);
    if (!book.cover_file_id) throw new ReadingValidationError("这本书还没有上传封面");
    const file = this.safePath(book.cover_file_id);
    if (!fs.existsSync(file)) throw new ReadingValidationError("封面文件缺失，请重新上传");
    const extension = path.extname(file).toLowerCase();
    return { path: file, contentType: extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg" };
  }

  removeCover(bookId: string): Entity {
    const book = this.store.get("books", bookId);
    if (book.cover_file_id) this.removeFile(book.cover_file_id);
    return this.store.update("books", bookId, { cover_file_id: null, cover_filename: null });
  }

  removeBookFiles(book: Entity): void {
    if (book.pdf_file_id) this.removeFile(book.pdf_file_id);
    if (book.cover_file_id) this.removeFile(book.cover_file_id);
  }

  private safePath(fileId: string): string {
    if (path.basename(fileId) !== fileId) throw new ReadingValidationError("附件路径无效");
    const resolved = path.resolve(this.paths.readingFilesDir, fileId);
    if (!resolved.startsWith(`${path.resolve(this.paths.readingFilesDir)}${path.sep}`)) throw new ReadingValidationError("附件路径无效");
    return resolved;
  }

  private removeFile(fileId: string): void {
    const file = this.safePath(fileId);
    if (fs.existsSync(file)) fs.unlinkSync(file);
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
