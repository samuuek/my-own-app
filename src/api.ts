import type { CollectionName, WorkspaceState, DashboardData, BackupRecord, Entity, FocusTimerSnapshot } from "./types";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type DesktopSystemStatus = {
  mode: "desktop";
  dataFile: { path: string; size: number; modifiedAt: string; writable: boolean };
  dataDirectory: string;
  backupsDirectory: string;
  exportsDirectory: string;
  latestBackup: BackupRecord | null;
  backupStatus: { state: "idle" | "ok" | "error"; lastAttemptAt: string | null; lastError: string | null; busy: boolean };
};

export type CloudSystemStatus = {
  mode: "cloud";
  database: { provider: "Neon"; status: "connected" };
  fileStorage: { provider: "Vercel Blob"; status: "connected" };
  recovery: { provider: "Neon restore window" };
};

export type SystemStatus = DesktopSystemStatus | CloudSystemStatus;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new ApiError(result?.error?.message ?? `操作失败（${response.status}）`, response.status);
  }
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  return result.data as T;
}

export const api = {
  state: () => request<WorkspaceState>("/api/state"),
  dashboard: (date: string) => request<DashboardData>(`/api/dashboard?date=${encodeURIComponent(date)}`),
  currentFocusTimer: () => request<FocusTimerSnapshot | null>("/api/focus-timers/current"),
  startFocusTimer: (input: { planItemId: string | null; plannedMinutes: number }) =>
    request<FocusTimerSnapshot>("/api/focus-timers", { method: "POST", body: JSON.stringify(input) }),
  pauseFocusTimer: (id: string) => request<FocusTimerSnapshot>(`/api/focus-timers/${id}/pause`, { method: "POST" }),
  resumeFocusTimer: (id: string) => request<FocusTimerSnapshot>(`/api/focus-timers/${id}/resume`, { method: "POST" }),
  finishFocusTimer: (id: string, status: "completed" | "cancelled" = "completed") =>
    request<FocusTimerSnapshot>(`/api/focus-timers/${id}/finish`, { method: "POST", body: JSON.stringify({ status }) }),
  search: (query: string) => request<Entity[]>(`/api/search?q=${encodeURIComponent(query)}`),
  create: (collection: CollectionName, input: Record<string, any>) =>
    request<Entity>(`/api/collections/${collection}`, { method: "POST", body: JSON.stringify(input) }),
  update: (collection: CollectionName, id: string, input: Record<string, any>) =>
    request<Entity>(`/api/collections/${collection}/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  remove: (collection: CollectionName, id: string) =>
    request<Entity>(`/api/collections/${collection}/${id}`, { method: "DELETE" }),
  restore: (collection: CollectionName, id: string) =>
    request<Entity>(`/api/collections/${collection}/${id}/restore`, { method: "POST" }),
  permanentDelete: (collection: CollectionName, id: string) =>
    request<void>(`/api/collections/${collection}/${id}/permanent`, { method: "DELETE" }),
  completePlan: (id: string) => request<Entity>(`/api/plan-items/${id}/complete`, { method: "POST" }),
  recordReadingProgress: (id: string, input: Record<string, any>) =>
    request<{ book: Entity; session: Entity; stats: Record<string, any>; suggestCompletion: boolean }>(`/api/books/${id}/progress`, { method: "POST", body: JSON.stringify(input) }),
  saveDailyReflection: (input: Record<string, any>) =>
    request<{ reflection: Entity; actions: Entity[] }>("/api/reflections/daily", { method: "PUT", body: JSON.stringify(input) }),
  addReflectionActionToPlan: (id: string) =>
    request<Entity>(`/api/reflection-actions/${id}/add-to-plan`, { method: "POST" }),
  uploadBookPdf: (id: string, file: File) => request<Entity>(`/api/books/${id}/pdf`, { method: "PUT", headers: { "Content-Type": "application/pdf", "X-File-Name": file.name }, body: file }),
  removeBookPdf: (id: string) => request<Entity>(`/api/books/${id}/pdf`, { method: "DELETE" }),
  uploadBookCover: (id: string, file: File) => request<Entity>(`/api/books/${id}/cover`, { method: "PUT", headers: { "Content-Type": file.type, "X-File-Name": file.name }, body: file }),
  removeBookCover: (id: string) => request<Entity>(`/api/books/${id}/cover`, { method: "DELETE" }),
  postponePlan: (id: string, date: string) =>
    request<Entity>(`/api/plan-items/${id}/postpone`, { method: "POST", body: JSON.stringify({ date }) }),
  getReview: (date: string) => request<Entity | null>(`/api/daily-reviews/${date}`),
  setReview: (date: string, content: string) =>
    request<Entity>(`/api/daily-reviews/${date}`, { method: "PUT", body: JSON.stringify({ content }) }),
  convertMemo: (id: string, collection: CollectionName, fields: Record<string, any>) =>
    request<Entity>(`/api/quick-memos/${id}/convert`, { method: "POST", body: JSON.stringify({ collection, fields }) }),
  settings: () => request<Record<string, any>>("/api/settings"),
  saveSettings: (input: Record<string, any>) => request<Record<string, any>>("/api/settings", { method: "PUT", body: JSON.stringify(input) }),
  systemStatus: () => request<SystemStatus>("/api/system/status"),
  saveNow: () => request<
    | { savedAt: string; database: string; dataFile: string; mode?: "desktop" }
    | { savedAt: string; database: "connected"; runtime: "cloud" }
  >("/api/system/save", { method: "POST" }),
  saveAndExit: () => request<{ savedAt: string; database: string; dataFile: string; exiting: boolean }>("/api/system/save-and-exit", { method: "POST" }),
  openDataDirectory: () => request<Record<string, any>>("/api/system/open-data-directory", { method: "POST" }),
  openPath: (path: string) => request<Record<string, any>>("/api/system/open-path", { method: "POST", body: JSON.stringify({ path }) }),
  backups: () => request<BackupRecord[]>("/api/backups"),
  createBackup: (label = "", keep = false) => request<BackupRecord>("/api/backups", { method: "POST", body: JSON.stringify({ label, keep }) }),
  updateBackup: (id: string, input: { label?: string; keep?: boolean }) => request<BackupRecord>(`/api/backups/${id}/metadata`, { method: "PATCH", body: JSON.stringify(input) }),
  restoreBackup: (id: string) => request<{ restored: boolean }>(`/api/backups/${id}/restore`, { method: "POST" }),
  exportAll: () => request<{ filename: string; path: string; size: number; downloadUrl: string }>("/api/export", { method: "POST" }),
};
