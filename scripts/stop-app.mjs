import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dataRoot = path.resolve(process.env.MUZI_DATA_DIR ?? path.join(os.homedir(), "Library", "Application Support", "MuziWorkspace"));
const pidFile = path.join(dataRoot, "muzi-workspace.pid");

if (!fs.existsSync(pidFile)) {
  console.log("木子工作台当前没有由启动器运行的进程。");
  process.exit(0);
}

let record;
try {
  record = JSON.parse(fs.readFileSync(pidFile, "utf8"));
} catch {
  console.error("启动记录无效，未停止任何进程。");
  process.exit(1);
}
const pid = Number(record.pid);
if (!Number.isSafeInteger(pid) || pid <= 1) {
  console.error("启动记录无效，未停止任何进程。");
  process.exit(1);
}

let command = "";
try {
  command = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }).trim();
} catch {
  command = "";
}
if (command && (!command.includes("dist-server/server/index.js") || !command.includes(record.projectRoot))) {
  console.error("启动记录指向的不是木子工作台进程，已拒绝停止。请删除无效的 PID 文件后重试。");
  process.exit(1);
}

try {
  process.kill(pid, "SIGTERM");
} catch (error) {
  if (error?.code !== "ESRCH") throw error;
}

let stopped = false;
for (let attempt = 0; attempt < 40; attempt += 1) {
  try {
    process.kill(pid, 0);
    await new Promise((resolve) => setTimeout(resolve, 125));
  } catch (error) {
    if (error?.code === "ESRCH") { stopped = true; break; }
    throw error;
  }
}

if (!stopped) {
  console.error("木子工作台没有在限定时间内退出，请查看日志后再试；未强制终止进程。");
  process.exit(1);
}
if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
console.log("木子工作台已安全停止。");
