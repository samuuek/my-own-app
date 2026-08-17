// @vitest-environment node
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { CloudExportService, type CloudExportBlobClient } from "../../server/cloud/export.js";

function stream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.close(); } });
}

describe("CloudExportService", () => {
  it("exports cloud state and collection CSV files to a private blob", async () => {
    let uploaded: Buffer | undefined;
    const blob: CloudExportBlobClient = {
      put: vi.fn(async (pathname, body) => {
        uploaded = body;
        return { pathname: pathname.replace(".zip", "-random.zip") };
      }),
      get: vi.fn(async () => ({ body: stream(), contentType: "application/zip" })),
    };
    const store = {
      state: vi.fn(async () => ({ planItems: [{ id: "plan-1", title: "Cloud task" }], settings: { theme: "dark" }, trash: [] })),
      list: vi.fn(async (name: string) => name === "planItems" ? [{ id: "plan-1", title: "Cloud task" }] : []),
    };
    const service = new CloudExportService(store, blob, () => new Date("2026-08-17T08:09:10.000Z"));
    const result = await service.create();
    expect(blob.put).toHaveBeenCalledWith(
      "exports/muzi-export-2026-08-17T08-09-10-000Z.zip",
      expect.any(Buffer),
      { access: "private", addRandomSuffix: true, contentType: "application/zip" },
    );
    expect(result).toMatchObject({ filename: "muzi-export-2026-08-17T08-09-10-000Z.zip", path: "private-cloud", downloadUrl: expect.stringMatching(/^\/api\/cloud-exports\//) });
    expect(result.size).toBe(uploaded?.byteLength);
    const zip = await JSZip.loadAsync(uploaded!);
    expect(JSON.parse(await zip.file("all-data.json")!.async("string"))).toMatchObject({ planItems: [{ title: "Cloud task" }] });
    expect(JSON.parse(await zip.file("manifest.json")!.async("string"))).toMatchObject({ app: "MuziWorkspace", formatVersion: 1 });
    expect(await zip.file("csv/planItems.csv")!.async("string")).toContain("Cloud task");
  });

  it("decodes only export pathnames before reading private data", async () => {
    const blob: CloudExportBlobClient = {
      put: vi.fn(),
      get: vi.fn(async () => ({ body: stream(), contentType: "application/zip" })),
    };
    const service = new CloudExportService({ state: vi.fn(), list: vi.fn() }, blob);
    const invalid = Buffer.from("reading/books/book-1/private.pdf").toString("base64url");
    await expect(service.read(invalid)).rejects.toThrow("导出文件路径无效");
    expect(blob.get).not.toHaveBeenCalled();

    const valid = Buffer.from("exports/private-cloud.zip").toString("base64url");
    const result = await service.read(valid);
    expect(blob.get).toHaveBeenCalledWith("exports/private-cloud.zip", { access: "private" });
    expect(result.filename).toBe("private-cloud.zip");
  });
});
