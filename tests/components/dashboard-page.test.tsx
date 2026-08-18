import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "../../src/pages/DashboardPage";
import { WorkspaceProvider } from "../../src/WorkspaceContext";

const collections = ["planItems", "importantDates", "longTermGoals", "focusTimers", "quickMemos", "mediaContents", "devProjects", "devMilestones", "devWorkItems", "devLogs", "clients", "consultingProjects", "consultingInteractions", "consultingDeliverables", "consultingFollowups", "consultingTimeEntries", "workoutTemplates", "workoutTemplateExercises", "workouts", "workoutExercises", "workoutSets", "bodyMetrics", "nutritionTargets", "foods", "meals", "mealItems", "entertainmentItems", "playSessions", "books", "readingSessions", "readingNotes", "dailyReflections", "reflectionActions", "thoughtNotes"];

function renderDashboard(onboarding: "pending" | "completed" | "skipped" | null = "skipped") {
  let activeTimer: Record<string, unknown> | null = null;
  let onboardingStatus = onboarding ?? undefined;
  const task = { id: "task-1", title: "整理首页", display_title: "整理首页", plan_date: "2026-08-15", estimated_minutes: 25, priority: "medium", status: "todo", sort_order: 0 };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    let data: any = null;
    if (url.startsWith("/api/state")) data = { ...Object.fromEntries(collections.map((name) => [name, name === "planItems" ? [task] : []])), settings: { appearance: "ios", ...(onboardingStatus === undefined ? {} : { progressWorkbenchOnboarding: onboardingStatus }) }, trash: [] };
    else if (url.startsWith("/api/dashboard")) data = { date: "2026-08-15", overview: { completed: 0, total: 1, progress: 0, scheduledMinutes: 25 }, timeline: [], unscheduled: [task], importantDates: [], longTermGoals: [], activeFocusTimer: activeTimer, sectionErrors: {}, attention: [], summaries: {} };
    else if (url === "/api/focus-timers" && init?.method === "POST") {
      activeTimer = { id: "timer-1", plan_item_id: task.id, status: "running", remainingSeconds: 1500, snapshotAt: new Date().toISOString(), actualSeconds: null };
      data = activeTimer;
    } else if (url === "/api/collections/importantDates" && init?.method === "POST") {
      data = { id: "date-1", ...JSON.parse(String(init.body)) };
    } else if (url === "/api/settings" && init?.method === "PUT") {
      onboardingStatus = JSON.parse(String(init.body)).progressWorkbenchOnboarding;
      data = { appearance: "ios", progressWorkbenchOnboarding: onboardingStatus };
    }
    return { ok: true, status: init?.method === "POST" ? 201 : 200, json: async () => ({ data }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter><QueryClientProvider client={client}><WorkspaceProvider><DashboardPage /></WorkspaceProvider></QueryClientProvider></MemoryRouter>);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("formal dashboard integration", () => {
  it("creates an important date and starts focus from an unfinished task", async () => {
    const fetchMock = renderDashboard();
    await userEvent.click(await screen.findByRole("button", { name: "添加重要日期" }));
    await userEvent.type(screen.getByLabelText("日期名称"), "纪念日");
    await userEvent.type(screen.getByLabelText("目标日期"), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: "保存重要日期" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/collections/importantDates",
      expect.objectContaining({ method: "POST", body: expect.stringContaining("纪念日") }),
    ));

    await userEvent.click(screen.getByRole("button", { name: "开始专注整理首页" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/focus-timers",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ planItemId: "task-1", plannedMinutes: 25 }) }),
    ));
  });

  it("opens only pending onboarding and persists skip", async () => {
    const fetchMock = renderDashboard(null);
    expect(await screen.findByRole("dialog", { name: "欢迎使用新的进度工作台" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ progressWorkbenchOnboarding: "skipped" }) }),
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "欢迎使用新的进度工作台" })).not.toBeInTheDocument());
  });

  it.each(["completed", "skipped"] as const)("does not reopen %s onboarding", async (status) => {
    renderDashboard(status);
    expect(await screen.findByText("今日进度")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "欢迎使用新的进度工作台" })).not.toBeInTheDocument();
  });
});
