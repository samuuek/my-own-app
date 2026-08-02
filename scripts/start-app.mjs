import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MUZI_PORT ?? 4317);
const baseUrl = `http://127.0.0.1:${port}`;
const dataRoot = path.resolve(process.env.MUZI_DATA_DIR ?? path.join(os.homedir(), "Library", "Application Support", "MuziWorkspace"));
const logsDir = path.join(dataRoot, "logs");
const pidFile = path.join(dataRoot, "muzi-workspace.pid");
const serverFile = path.join(projectRoot, "dist-server", "server", "index.js");
const webFile = path.join(projectRoot, "dist", "index.html");

fs.mkdirSync(logsDir, { recursive: true });

if (await healthy()) {
  maybeOpenBrowser();
  console.log(`木子工作台已经在运行：${baseUrl}`);
  process.exit(0);
}

if (!fs.existsSync(serverFile) || !fs.existsSync(webFile)) {
  console.log("首次启动需要生成本地运行文件……");
  const build = spawnSync("npm", ["run", "build"], { cwd: projectRoot, stdio: "inherit", env: process.env });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const logFile = path.join(logsDir, "app.log");
const logDescriptor = fs.openSync(logFile, "a");
const child = spawn(process.execPath, [serverFile], {
  cwd: projectRoot,
  detached: true,
  env: { ...process.env, NODE_ENV: "production", MUZI_PORT: String(port), MUZI_DATA_DIR: dataRoot },
  stdio: ["ignore", logDescriptor, logDescriptor],
});
child.unref();
fs.closeSync(logDescriptor);
fs.writeFileSync(pidFile, JSON.stringify({ pid: child.pid, projectRoot, createdAt: new Date().toISOString() }, null, 2), "utf8");

for (let attempt = 0; attempt < 80; attempt += 1) {
  if (await healthy()) {
    maybeOpenBrowser();
    console.log(`木子工作台已启动：${baseUrl}`);
    console.log(`数据目录：${dataRoot}`);
    process.exit(0);
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

try { process.kill(child.pid, "SIGTERM"); } catch { /* The child may already have exited. */ }
if (fs.existsSync(pidFile)) fs.unlinkSync(pidFile);
console.error(`启动失败，请查看日志：${logFile}`);
process.exit(1);

async function healthy() {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(800) });
    return response.ok && (await response.json()).data?.status === "ok";
  } catch {
    return false;
  }
}

function maybeOpenBrowser() {
  if (process.env.MUZI_NO_OPEN === "1") return;
  const opener = spawn("open", [baseUrl], { detached: true, stdio: "ignore" });
  opener.unref();
}
