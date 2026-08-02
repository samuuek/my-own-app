import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("production server serves the built app and API on loopback", async (context) => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muzi-production-"));
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(projectRoot, "dist-server", "server", "index.js")], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: "production", MUZI_DATA_DIR: dataRoot, MUZI_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(dataRoot, { recursive: true, force: true });
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl, child, () => output);
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.equal(health.data.status, "ok");
  assert.equal(health.data.database, "ok");

  const home = await fetch(baseUrl).then((response) => response.text());
  assert.match(home, /<div id="root"><\/div>/);
  assert.match(home, /\/assets\/[^"']+\.js/);
  const clientRoute = await fetch(`${baseUrl}/today`).then((response) => response.text());
  assert.match(clientRoute, /<title>木子工作台<\/title>/);
});

test("desktop launcher starts, records and safely stops the local server", async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "muzi-launcher-"));
  const port = await freePort();
  const env = { ...process.env, MUZI_DATA_DIR: dataRoot, MUZI_PORT: String(port), MUZI_NO_OPEN: "1" };
  try {
    const started = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "start-app.mjs")], { cwd: projectRoot, env, encoding: "utf8", timeout: 30_000 });
    assert.equal(started.status, 0, `${started.stdout}\n${started.stderr}`);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.data.status, "ok");
    const pidFile = path.join(dataRoot, "muzi-workspace.pid");
    const record = JSON.parse(fs.readFileSync(pidFile, "utf8"));
    assert.equal(Number.isSafeInteger(record.pid), true);
    assert.equal(record.projectRoot, projectRoot);

    const stopped = spawnSync(process.execPath, [path.join(projectRoot, "scripts", "stop-app.mjs")], { cwd: projectRoot, env, encoding: "utf8", timeout: 15_000 });
    assert.equal(stopped.status, 0, `${stopped.stdout}\n${stopped.stderr}`);
    assert.equal(fs.existsSync(pidFile), false);
  } finally {
    const pidFile = path.join(dataRoot, "muzi-workspace.pid");
    if (fs.existsSync(pidFile)) {
      try { process.kill(JSON.parse(fs.readFileSync(pidFile, "utf8")).pid, "SIGTERM"); } catch { /* Already stopped. */ }
    }
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, child, getOutput) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`生产服务提前退出（${child.exitCode}）：${getOutput()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`生产服务未在限定时间内启动：${getOutput()}`);
}
