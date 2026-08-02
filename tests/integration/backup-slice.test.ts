// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackupManager } from "../../server/backup.js";
import { getAppPaths } from "../../server/config.js";
import { DatabaseManager } from "../../server/database.js";
import { AppStore } from "../../server/store.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
afterEach(() => { if (directory) removeTestDirectory(directory); directory = ""; });

describe("backup technical slice", () => {
  it("creates an independent valid backup and restores its snapshot", async () => {
    directory = makeTestDirectory("backup-slice");
    const paths = getAppPaths(directory);
    const manager = new DatabaseManager(paths);
    const store = new AppStore(manager);
    const backups = new BackupManager(manager, store, paths);
    try {
      const item = store.create("planItems", { title: "备份中的标题", plan_date: "2026-08-02" });
      const backup = await backups.create("manual", "阶段1验证", false);
      expect(fs.existsSync(path.join(paths.backupsDir, backup.filename))).toBe(true);
      expect(path.join(paths.backupsDir, backup.filename)).not.toBe(paths.dataFile);
      store.update("planItems", item.id, { title: "恢复前的修改" });
      await backups.restore(backup.id);
      expect(store.get("planItems", item.id).title).toBe("备份中的标题");
      expect(backups.list().some((entry) => entry.type === "safety" && entry.keep)).toBe(true);
    } finally {
      manager.close();
    }
  });
});
