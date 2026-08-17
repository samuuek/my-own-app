import Fastify from "fastify";
import { configureCloudApp } from "./dist-server/server/cloud/app.js";

const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
await configureCloudApp(app, { serveStatic: true });
await app.listen({ port: Number(process.env.PORT) || 3000, host: "0.0.0.0" });

export default app;
