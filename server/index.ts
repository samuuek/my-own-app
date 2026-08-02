import { buildApp } from "./app.js";
import { APP_HOST, APP_PORT } from "./config.js";

const app = await buildApp({ logger: true, serveStatic: process.env.NODE_ENV === "production" });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "正在安全关闭木子工作台");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: APP_HOST, port: APP_PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
