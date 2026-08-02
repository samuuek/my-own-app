import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { useWorkspace, WorkspaceProvider } from "../../src/WorkspaceContext";

const collections = ["planItems", "quickMemos", "mediaContents", "devProjects", "devMilestones", "devWorkItems", "devLogs", "clients", "consultingProjects", "consultingInteractions", "consultingDeliverables", "consultingFollowups", "consultingTimeEntries", "workoutTemplates", "workoutTemplateExercises", "workouts", "workoutExercises", "workoutSets", "bodyMetrics", "nutritionTargets", "foods", "meals", "mealItems", "entertainmentItems", "playSessions"];

function mockApi(theme = "light", backupStatus: Record<string, any> | null = null) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: any = null;
    if (url.startsWith("/api/state")) data = { ...Object.fromEntries(collections.map((name) => [name, []])), settings: { theme }, trash: [] };
    else if (url.startsWith("/api/dashboard")) data = { date: "2026-08-02", overview: { completed: 0, total: 0, progress: 0, scheduledMinutes: 0 }, timeline: [], unscheduled: [], attention: [], summaries: { media: [], development: [], consulting: [], fitness: [], diet: [], entertainment: [] } };
    else if (url.startsWith("/api/system/status")) data = { latestBackup: null, backupStatus };
    return { ok: true, status: 200, json: async () => ({ data }) } as Response;
  }));
}

function SaveFailureTrigger() {
  const { run } = useWorkspace();
  return <button onClick={() => void run(async () => { throw new Error("数据文件不可写"); }).catch(() => undefined)}>制造保存失败</button>;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorkspaceProvider><App /></WorkspaceProvider></QueryClientProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); window.history.pushState({}, "", "/"); });

describe("application shell", () => {
  it("renders all nine requested navigation destinations", async () => {
    mockApi();
    renderApp();
    for (const label of ["首页总览", "今日计划", "自媒体", "开发工作", "咨询工作", "健身计划", "饮食计划", "游戏娱乐", "数据与设置"]) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /搜索所有内容/ })).toBeInTheDocument();
    expect(screen.getByText("仅保存在这台电脑")).toBeInTheDocument();
  });

  it("applies the persisted theme to the document", async () => {
    mockApi("dark");
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("shows save failure instead of a false saved state", async () => {
    mockApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceProvider><SaveFailureTrigger /><App /></WorkspaceProvider></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "制造保存失败" }));
    expect(await screen.findByRole("status")).toHaveTextContent("保存失败");
  });

  it("surfaces automatic backup failure in the application shell", async () => {
    mockApi("light", { state: "error", lastError: "备份目录不可写" });
    renderApp();
    expect(await screen.findByText("自动备份失败")).toBeInTheDocument();
    expect(screen.getByText("备份目录不可写")).toBeInTheDocument();
  });
});
