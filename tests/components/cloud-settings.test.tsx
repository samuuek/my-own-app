import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { WorkspaceProvider } from "../../src/WorkspaceContext";
import { AppLayout } from "../../src/components/Layout";

const collections = ["planItems", "importantDates", "longTermGoals", "focusTimers", "quickMemos", "mediaContents", "devProjects", "devMilestones", "devWorkItems", "devLogs", "clients", "consultingProjects", "consultingInteractions", "consultingDeliverables", "consultingFollowups", "consultingTimeEntries", "workoutTemplates", "workoutTemplateExercises", "workouts", "workoutExercises", "workoutSets", "bodyMetrics", "nutritionTargets", "foods", "meals", "mealItems", "entertainmentItems", "playSessions", "books", "readingSessions", "readingNotes", "dailyReflections", "reflectionActions", "thoughtNotes"];

function renderSettings(mode: "cloud" | "desktop") {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const data = url === "/api/state"
      ? { ...Object.fromEntries(collections.map((name) => [name, []])), settings: {}, trash: [] }
      : url === "/api/backups" ? []
        : mode === "cloud"
          ? { mode: "cloud", database: { provider: "Neon", status: "connected" }, fileStorage: { provider: "Vercel Blob", status: "connected" }, recovery: { provider: "Neon restore window" } }
          : { mode: "desktop", dataFile: { path: "C:/test/app.sqlite", size: 1024, modifiedAt: "2026-08-17T00:00:00.000Z", writable: true }, latestBackup: null, backupStatus: { state: "ok" } };
    return { ok: true, status: 200, json: async () => ({ data }) } as Response;
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><WorkspaceProvider><SettingsPage /></WorkspaceProvider></QueryClientProvider></MemoryRouter>);
}

afterEach(() => vi.unstubAllGlobals());

describe("cloud settings", () => {
  it("shows protected cloud providers and hides local-only controls", async () => {
    renderSettings("cloud");
    expect(await screen.findByText("Neon")).toBeInTheDocument();
    expect(screen.getByText("Vercel Blob")).toBeInTheDocument();
    expect(screen.getByText(/受保护的云端副本/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 ZIP" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /打开数据目录/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /立即备份/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/恢复/)).not.toBeInTheDocument();
    expect(screen.queryByText("C:/test/app.sqlite")).not.toBeInTheDocument();
  });

  it("keeps desktop data file and backup controls unchanged", async () => {
    renderSettings("desktop");
    expect(await screen.findByText("C:/test/app.sqlite")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /打开数据目录/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /立即备份/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 ZIP" })).toBeInTheDocument();
  });

  it("hides desktop exit controls in the cloud application shell", async () => {
    renderSettings("cloud").unmount();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <WorkspaceProvider>
            <Routes><Route element={<AppLayout />}><Route index element={<div>Cloud workspace</div>} /></Route></Routes>
          </WorkspaceProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("受保护的云端副本")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存并退出" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动保存" })).toBeInTheDocument();
  });
});
