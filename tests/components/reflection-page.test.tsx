import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReflectionPage } from "../../src/pages/ReflectionPage";
import { WorkspaceProvider } from "../../src/WorkspaceContext";

afterEach(() => vi.unstubAllGlobals());

describe("reflection page", () => {
  it("shows today's structured review, free thoughts and history filters", async () => {
    vi.setSystemTime(new Date("2026-08-13T09:00:00+08:00"));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {
      planItems: [], quickMemos: [], mediaContents: [], devProjects: [], devMilestones: [], devWorkItems: [], devLogs: [], clients: [], consultingProjects: [], consultingInteractions: [], consultingDeliverables: [], consultingFollowups: [], consultingTimeEntries: [], workoutTemplates: [], workoutTemplateExercises: [], workouts: [], workoutExercises: [], workoutSets: [], bodyMetrics: [], nutritionTargets: [], foods: [], meals: [], mealItems: [], entertainmentItems: [], playSessions: [], books: [], readingSessions: [], readingNotes: [], settings: {}, trash: [],
      dailyReflections: [{ id: "r1", reflection_date: "2026-08-13", source_category: "work", source_detail: "阅读模块", work_summary: "完成开发", life_summary: "散步", gains: "拆小任务", problems: "时间估计偏差", improvements: "提前验证" }],
      reflectionActions: [{ id: "a1", reflection_id: "r1", content: "整理发布说明", plan_item_id: "p1" }],
      thoughtNotes: [{ id: "n1", note_date: "2026-08-13", title: "一次对话", source_category: "conversation", source_detail: "朋友", content: "具体问题带来具体答案" }],
    } }) })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceProvider><MemoryRouter><ReflectionPage /></MemoryRouter></WorkspaceProvider></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "思考" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("今日工作总结")).toHaveValue("完成开发"));
    expect(screen.getByText("整理发布说明")).toBeInTheDocument();
    expect(screen.getByText("已加入计划")).toBeInTheDocument();
    expect(screen.getByText("一次对话")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("搜索历史思考"), "朋友");
    expect(screen.getByText("一次对话")).toBeInTheDocument();
  });
});
