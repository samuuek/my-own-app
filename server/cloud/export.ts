import path from "node:path";
import JSZip from "jszip";
import { get, put } from "@vercel/blob";
import { collectionDefinitions, type CollectionName } from "../collections.js";
import { NotFoundError, ValidationError } from "../errors.js";
import type { Entity } from "../store.js";

type ExportPutOptions = { access: "private"; addRandomSuffix: true; contentType: "application/zip" };
type ExportReadResult = { body: ReadableStream<Uint8Array>; contentType: string };

export type CloudExportBlobClient = {
  put(pathname: string, body: Buffer, options: ExportPutOptions): Promise<{ pathname: string }>;
  get(pathname: string, options: { access: "private" }): Promise<ExportReadResult | null>;
};

type ExportStore = {
  state(): Promise<Record<string, any>>;
  list(name: CollectionName, includeDeleted?: boolean): Promise<Entity[]>;
};

const vercelExportBlobClient: CloudExportBlobClient = {
  put: async (pathname, body, options) => put(pathname, body, options),
  get: async (pathname, options) => {
    const result = await get(pathname, options);
    if (!result || result.statusCode !== 200) return null;
    return { body: result.stream, contentType: result.blob.contentType };
  },
};

export class CloudExportService {
  constructor(
    private readonly store: ExportStore,
    private readonly blob: CloudExportBlobClient = vercelExportBlobClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(): Promise<{ filename: string; path: "private-cloud"; size: number; downloadUrl: string }> {
    const exportedAt = this.now();
    const state = await this.store.state();
    const zip = new JSZip();
    zip.file("manifest.json", JSON.stringify({
      exportedAt: exportedAt.toISOString(),
      app: "MuziWorkspace",
      schemaVersion: "001_workspace.sql",
      formatVersion: 1,
    }, null, 2));
    zip.file("all-data.json", JSON.stringify(state, null, 2));
    const folder = zip.folder("csv")!;
    const collections = Object.keys(collectionDefinitions) as CollectionName[];
    const rows = await Promise.all(collections.map((name) => this.store.list(name, true)));
    for (const [index, name] of collections.entries()) folder.file(`${name}.csv`, toCsv(rows[index]));
    zip.file("attachments/manifest.json", JSON.stringify({ version: 1, files: [] }, null, 2));
    const body = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const filename = `muzi-export-${safeTimestamp(exportedAt)}.zip`;
    const uploaded = await this.blob.put(`exports/${filename}`, body, {
      access: "private",
      addRandomSuffix: true,
      contentType: "application/zip",
    });
    const token = Buffer.from(uploaded.pathname, "utf8").toString("base64url");
    return {
      filename,
      path: "private-cloud",
      size: body.byteLength,
      downloadUrl: `/api/cloud-exports/${token}`,
    };
  }

  async read(token: string): Promise<{ body: ReadableStream<Uint8Array>; filename: string }> {
    let pathname: string;
    try {
      pathname = Buffer.from(token, "base64url").toString("utf8");
    } catch {
      throw new ValidationError("导出文件路径无效");
    }
    if (!isExportPath(pathname)) throw new ValidationError("导出文件路径无效");
    const result = await this.blob.get(pathname, { access: "private" });
    if (!result) throw new NotFoundError("没有找到导出文件");
    return { body: result.body, filename: path.posix.basename(pathname) };
  }
}

function isExportPath(value: string): boolean {
  return value.startsWith("exports/")
    && value.length > "exports/".length
    && !value.includes("..")
    && !value.includes("\\")
    && path.posix.basename(value) === value.slice("exports/".length);
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function toCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const escape = (value: any) => {
    const text = value === null || value === undefined ? "" : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [columns.map(escape).join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n");
}
