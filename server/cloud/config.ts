export type CloudConfig = {
  runtime: "cloud";
  databaseUrl: string;
  blobEnabled: boolean;
};

export function readCloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  if (env.MUZI_RUNTIME !== "cloud") throw new Error("MUZI_RUNTIME 必须设置为 cloud");
  if (!env.DATABASE_URL) throw new Error("缺少 DATABASE_URL");

  return {
    runtime: "cloud",
    databaseUrl: env.DATABASE_URL,
    blobEnabled: Boolean(env.BLOB_READ_WRITE_TOKEN),
  };
}
