import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { useWorkspace, WorkspaceProvider } from "../../src/WorkspaceContext";
import { SettingsPage } from "../../src/pages/SettingsPage";

const collections = ["planItems", "importantDates", "longTermGoals", "focusTimers", "quickMemos", "mediaContents", "devProjects", "devMilestones", "devWorkItems", "devLogs", "clients", "consultingProjects", "consultingInteractions", "consultingDeliverables", "consultingFollowups", "consultingTimeEntries", "workoutTemplates", "workoutTemplateExercises", "workouts", "workoutExercises", "workoutSets", "bodyMetrics", "nutritionTargets", "foods", "meals", "mealItems", "entertainmentItems", "playSessions", "books", "readingSessions", "readingNotes", "dailyReflections", "reflectionActions", "thoughtNotes"];

function mockApi(theme = "light", backupStatus: Record<string, any> | null = null, appearance?: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    let data: any = null;
    if (url.startsWith("/api/state")) data = { ...Object.fromEntries(collections.map((name) => [name, []])), settings: { theme, ...(appearance === undefined ? {} : { appearance }) }, trash: [] };
    else if (url.startsWith("/api/dashboard")) data = { date: "2026-08-02", overview: { completed: 0, total: 0, progress: 0, scheduledMinutes: 0 }, timeline: [], unscheduled: [], importantDates: [], longTermGoals: [], activeFocusTimer: null, sectionErrors: {}, attention: [], summaries: { media: [], development: [], consulting: [], fitness: [], diet: [], entertainment: [] } };
    else if (url.startsWith("/api/system/status")) data = {
      latestBackup: null,
      backupStatus,
      dataFile: { path: "C:/test/app.sqlite", size: 1024, modifiedAt: "2026-08-15T01:00:00.000Z", writable: true },
      dataDirectory: "C:/test",
      backupsDirectory: "C:/test/backups",
      exportsDirectory: "C:/test/exports",
    };
    else if (url.startsWith("/api/system/save")) data = { savedAt: "2026-08-02T12:00:00.000Z", database: "ok", dataFile: "/tmp/app.sqlite" };
    return { ok: true, status: 200, json: async () => ({ data }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function SaveFailureTrigger() {
  const { run } = useWorkspace();
  return <button onClick={() => void run(async () => { throw new Error("数据文件不可写"); }).catch(() => undefined)}>制造保存失败</button>;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><WorkspaceProvider><App /></WorkspaceProvider></QueryClientProvider>);
}

afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute("data-theme"); document.documentElement.removeAttribute("data-appearance"); window.history.pushState({}, "", "/"); });

describe("application shell", () => {
  it("renders all eleven requested navigation destinations", async () => {
    mockApi();
    const { container } = renderApp();
    for (const label of ["首页总览", "今日计划", "自媒体", "开发工作", "咨询工作", "健身计划", "饮食计划", "游戏娱乐", "读书", "思考", "数据与设置"]) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /搜索所有内容/ })).toBeInTheDocument();
    expect(screen.getByText("仅保存在这台电脑")).toBeInTheDocument();
    expect(container.querySelector(".brand-mark img")).toHaveAttribute("src", "/assets/app/app-icon-brand-512-v2.png");
    expect(container.querySelector(".brand-mark")).toHaveTextContent("");
  });

  it("applies the persisted theme to the document", async () => {
    mockApi("dark");
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });

  it("uses iPhone system as the safe default for missing, legacy and unknown appearance values", async () => {
    mockApi("light", null, "glass");
    const first = renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("ios"));
    expect(document.querySelector(".ios-shell")).toBeInTheDocument();
    expect(document.querySelector(".ambient-environment")).not.toBeInTheDocument();
    expect(document.querySelector(".neo-shell")).not.toBeInTheDocument();
    first.unmount();

    mockApi("light", null, "legacy-paper");
    const second = renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("ios"));
    expect(document.querySelector(".ios-shell")).toBeInTheDocument();
    second.unmount();

    mockApi();
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("ios"));
  });

  it("keeps persisted liquid appearance and its ambient layer", async () => {
    mockApi("light", null, "liquid");
    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("liquid"));
    expect(document.querySelector(".ambient-environment")).toBeInTheDocument();
  });

  it("applies the persisted notebook appearance without liquid or neo environment layers", async () => {
    mockApi("dark", null, "notebook");
    const { container } = renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("notebook"));
    expect(container.querySelector(".notebook-environment")).toBeInTheDocument();
    expect(container.querySelector(".ambient-environment")).not.toBeInTheDocument();
    expect(container.querySelector(".neo-shell")).not.toBeInTheDocument();
  });

  it("applies a persisted neo appearance without mounting liquid-only visuals", async () => {
    mockApi("dark", null, "neo");
    const { container } = renderApp();
    await waitFor(() => expect(document.documentElement.dataset.appearance).toBe("neo"));
    expect(container.querySelector(".app-shell")).toHaveClass("neo-shell");
    expect(document.querySelector(".ambient-environment")).not.toBeInTheDocument();
    expect(container.querySelector(".brand-mark img")).toHaveAttribute("src", "/assets/app/app-icon-brand-512-v2.png");
    expect(container.querySelectorAll(".neo-nav-emblem")).toHaveLength(11);
  });

  it("offers iPhone system as a fourth appearance in settings", async () => {
    mockApi("light", null, "ios");
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<MemoryRouter><QueryClientProvider client={client}><WorkspaceProvider><SettingsPage /></WorkspaceProvider></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "iPhone 系统" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Liquid Glass" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notion 笔记" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Neo-Brutalism" })).toBeInTheDocument();
  });

  it("shows save failure instead of a false saved state", async () => {
    mockApi();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceProvider><SaveFailureTrigger /><App /></WorkspaceProvider></QueryClientProvider>);
    await userEvent.click(await screen.findByRole("button", { name: "制造保存失败" }));
    expect(await screen.findByRole("status")).toHaveTextContent("保存失败");
  });

  it("offers a manual save button and confirms a successful disk save", async () => {
    const fetchMock = mockApi();
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "手动保存" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/system/save",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");
  });

  it("saves pending data before requesting a safe service exit", async () => {
    const fetchMock = mockApi();
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "保存并退出" }));
    expect(await screen.findByText("数据已保存，samuel的工作台已安全退出")).toBeInTheDocument();
    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calls).toContain("/api/system/save");
    expect(calls).toContain("/api/system/save-and-exit");
    expect(calls.indexOf("/api/system/save")).toBeLessThan(calls.indexOf("/api/system/save-and-exit"));
  });

  it("surfaces automatic backup failure in the application shell", async () => {
    mockApi("light", { state: "error", lastError: "备份目录不可写" });
    renderApp();
    expect(await screen.findByText("自动备份失败")).toBeInTheDocument();
    expect(screen.getByText("备份目录不可写")).toBeInTheDocument();
  });
});
