// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readCloudConfig } from "../../server/cloud/config.js";

describe("cloud runtime configuration", () => {
  it("rejects a cloud runtime without a database URL", () => {
    expect(() => readCloudConfig({ MUZI_RUNTIME: "cloud" })).toThrow("DATABASE_URL");
  });

  it("enables blob storage when Vercel provides its token", () => {
    expect(readCloudConfig({
      MUZI_RUNTIME: "cloud",
      DATABASE_URL: "postgresql://example.invalid/db",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test",
    })).toMatchObject({ runtime: "cloud", blobEnabled: true });
  });
});
