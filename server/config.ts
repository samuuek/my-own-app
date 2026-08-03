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
      defaultDataRoot(),
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

function defaultDataRoot(): string {
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? os.homedir(), "MuziWorkspace");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MuziWorkspace");
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"), "MuziWorkspace");
}
