// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { BackupManager } from "../../server/backup.js";
import { getAppPaths } from "../../server/config.js";
import { DatabaseManager } from "../../server/database.js";
import { AppStore } from "../../server/store.js";
import { makeTestDirectory, removeTestDirectory } from "../helpers.js";

let directory = "";
afterEach(() => { if (directory) removeTestDirectory(directory); directory = ""; });

function setup(label: string) {
  directory = makeTestDirectory(label);
  const paths = getAppPaths(directory);
  const manager = new DatabaseManager(paths);
  const store = new AppStore(manager);
  const backups = new BackupManager(manager, store, paths);
  return { paths, manager, store, backups };
}

describe("production backup, restore and export", () => {
  it("creates at most one automatic backup per day and preserves metadata", async () => {
    const { manager, backups } = setup("backup-daily");
    try {
      const first = await backups.ensureDailyBackup();
      const second = await backups.ensureDailyBackup();
      expect(first?.type).toBe("automatic");
      expect(second).toBeNull();
      const updated = backups.updateMetadata(first!.id, { label: "稳定版本", keep: true });
      expect(updated).toMatchObject({ label: "稳定版本", keep: true });
      expect(backups.list()[0]).toMatchObject({ label: "稳定版本", keep: true });
    } finally {
      manager.close();
    }
  });

  it("keeps only the newest 30 ordinary automatic backups while retaining protected ones", async () => {
    const { manager, backups } = setup("backup-retention");
    try {
      const protectedBackup = await backups.create("automatic", "长期保留", true);
      for (let index = 0; index < 31; index += 1) await backups.create("automatic", `自动 ${index}`, false);
      const tomorrow = new Date(Date.now() + 86_400_000);
      await backups.ensureDailyBackup(tomorrow);
      const records = backups.list();
      expect(records.filter((item) => item.type === "automatic" && !item.keep)).toHaveLength(30);
      expect(records.some((item) => item.id === protectedBackup.id && item.keep)).toBe(true);
    } finally {
      manager.close();
    }
  }, 20_000);

  it("rejects a corrupted backup without changing current data and remains usable", async () => {
    const { paths, manager, store, backups } = setup("backup-corrupt");
    try {
      const item = store.create("planItems", { title: "当前可靠数据", plan_date: "2026-08-02" });
      const backup = await backups.create("manual", "即将损坏", false);
      fs.writeFileSync(path.join(paths.backupsDir, backup.filename), "not a sqlite database");
      await expect(backups.restore(backup.id)).rejects.toThrow();
      expect(store.get("planItems", item.id).title).toBe("当前可靠数据");
      expect(manager.integrityCheck()).toBe("ok");
    } finally {
      manager.close();
    }
  });

  it("exports a readable ZIP with manifest, JSON and per-module CSV files", async () => {
    const { manager, store, backups } = setup("export");
    try {
      store.create("mediaContents", { title: "导出内容", stage: "idea" });
      store.create("entertainmentItems", { name: "导出游戏", status: "playing" });
      const result = await backups.exportAll();
      const zip = await JSZip.loadAsync(fs.readFileSync(result.path));
      expect(zip.file("manifest.json")).not.toBeNull();
      expect(zip.file("all-data.json")).not.toBeNull();
      expect(zip.file("csv/mediaContents.csv")).not.toBeNull();
      const allData = JSON.parse(await zip.file("all-data.json")!.async("string"));
      expect(allData.mediaContents[0].title).toBe("导出内容");
      expect(allData.entertainmentItems[0].name).toBe("导出游戏");
    } finally {
      manager.close();
    }
  });

  it("records backup failure state for the application shell", async () => {
    const { paths, manager, backups } = setup("backup-error");
    try {
      fs.renameSync(paths.backupsDir, `${paths.backupsDir}-moved`);
      fs.writeFileSync(paths.backupsDir, "blocking file");
      await expect(backups.create("manual", "应失败", false)).rejects.toThrow();
      expect(backups.getStatus()).toMatchObject({ state: "error", busy: false });
      expect(backups.getStatus().lastError).toBeTruthy();
    } finally {
      manager.close();
    }
  });
});
