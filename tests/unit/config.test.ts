// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_HOST, getAppPaths } from "../../server/config.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
afterEach(() => { if (directory) removeTestDirectory(directory); directory = ""; });

describe("local application configuration", () => {
  it("binds only to the loopback address", () => {
    expect(APP_HOST).toBe("127.0.0.1");
  });

  it("creates separate data, backup, export and log directories", () => {
    directory = makeTestDirectory("config");
    const paths = getAppPaths(directory);
    expect(paths.dataFile).toBe(path.join(directory, "data", "app.sqlite"));
    expect(fs.existsSync(path.dirname(paths.dataFile))).toBe(true);
    expect(fs.existsSync(paths.backupsDir)).toBe(true);
    expect(fs.existsSync(paths.exportsDir)).toBe(true);
    expect(fs.existsSync(paths.logsDir)).toBe(true);
  });
});
