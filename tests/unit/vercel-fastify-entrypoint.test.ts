// @vitest-environment node
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

describe("Vercel Fastify entrypoint", () => {
  it("directly imports Fastify for the installed framework detector", async () => {
    const entrypoint = path.join(process.cwd(), "server.mjs");
    const source = await readFile(entrypoint, "utf8");
    expect(source).toMatch(/import\s+Fastify\s+from\s+["']fastify["']/);
    expect(source).toContain('./dist-server/server/cloud/app.js');
  });

  it("starts listening on PORT", async () => {
    const port = await availablePort();
    process.env.MUZI_RUNTIME = "cloud";
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/muzi";
    process.env.BLOB_READ_WRITE_TOKEN = "test-only";
    process.env.PORT = String(port);
    const entrypoint = pathToFileURL(path.join(process.cwd(), "server.mjs")).href;
    const { default: app } = await import(entrypoint);
    try {
      expect(app.server.listening).toBe(true);
      const address = app.server.address();
      expect(address && typeof address === "object" ? address.port : 0).toBe(port);
    } finally {
      await app.close();
    }
  });
});
