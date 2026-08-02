import os from "node:os";
import path from "node:path";
import { mkdirSync } from "node:fs";

export type AppPaths = {
  root: string;
  dataFile: string;
  backupsDir: string;
  exportsDir: string;
  logsDir: string;
  backupIndex: string;
};

export function getAppPaths(override?: string): AppPaths {
  const root = path.resolve(
    override ??
      process.env.MUZI_DATA_DIR ??
      path.join(os.homedir(), "Library", "Application Support", "MuziWorkspace"),
  );
  const paths: AppPaths = {
    root,
    dataFile: path.join(root, "data", "app.sqlite"),
    backupsDir: path.join(root, "backups"),
    exportsDir: path.join(root, "exports"),
    logsDir: path.join(root, "logs"),
    backupIndex: path.join(root, "backups", "index.json"),
  };
  for (const directory of [
    path.dirname(paths.dataFile),
    paths.backupsDir,
    paths.exportsDir,
    paths.logsDir,
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  return paths;
}

export const APP_HOST = "127.0.0.1";
export const APP_PORT = Number(process.env.MUZI_PORT ?? 4317);
