export type CloudSystemStatus = {
  mode: "cloud";
  database: { provider: "Neon"; status: "connected" };
  fileStorage: { provider: "Vercel Blob"; status: "connected" };
  recovery: { provider: "Neon restore window" };
};

export function cloudSystemStatus(): CloudSystemStatus {
  return {
    mode: "cloud",
    database: { provider: "Neon", status: "connected" },
    fileStorage: { provider: "Vercel Blob", status: "connected" },
    recovery: { provider: "Neon restore window" },
  };
}

export class DesktopOnlyError extends Error {
  readonly statusCode = 409;
  readonly code = "DESKTOP_ONLY";

  constructor() {
    super("此操作仅在桌面版中可用");
  }
}

export function isAllowedWriteOrigin(
  origin: string | undefined,
  host: string | undefined,
  runtime: "desktop" | "cloud",
  forwardedProtocol?: string,
): boolean {
  if (!origin) return true;
  if (runtime === "desktop") return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    const protocol = forwardedProtocol?.split(",")[0]?.trim() || "https";
    return parsed.protocol === `${protocol}:` && parsed.protocol === "https:" && parsed.host === host;
  } catch {
    return false;
  }
}
