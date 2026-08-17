// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { readCloudConfig } from "../../server/cloud/config.js";

describe("cloud runtime configuration", () => {
  it("keeps the Vercel CLI isolated from application dependencies", () => {
    const packageJson = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const packageLock = JSON.parse(fs.readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    expect(packageJson.devDependencies).not.toHaveProperty("vercel");
    expect(packageLock.packages[""].devDependencies).not.toHaveProperty("vercel");
    expect(Object.keys(packageLock.packages).some((entry) => entry === "node_modules/vercel" || entry.startsWith("node_modules/vercel/"))).toBe(false);
  });

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
