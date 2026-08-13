import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingPage } from "../../src/pages/ReadingPage";
import { WorkspaceProvider } from "../../src/WorkspaceContext";

afterEach(() => vi.unstubAllGlobals());

describe("reading page", () => {
  it("shows a filtered shelf with progress and note totals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {
      planItems: [], quickMemos: [], mediaContents: [], devProjects: [], devMilestones: [], devWorkItems: [], devLogs: [], clients: [], consultingProjects: [], consultingInteractions: [], consultingDeliverables: [], consultingFollowups: [], consultingTimeEntries: [], workoutTemplates: [], workoutTemplateExercises: [], workouts: [], workoutExercises: [], workoutSets: [], bodyMetrics: [], nutritionTargets: [], foods: [], meals: [], mealItems: [], entertainmentItems: [], playSessions: [], settings: {}, trash: [],
      books: [{ id: "b1", title: "思考，快与慢", author: "丹尼尔·卡尼曼", status: "reading", current_page: 100, total_pages: 500, last_read_at: "2026-08-12T09:00:00.000Z" }],
      readingSessions: [{ id: "s1", book_id: "b1", start_page: 1, end_page: 100, duration_minutes: 120 }],
      readingNotes: [{ id: "n1", book_id: "b1", chapter: "系统一" }, { id: "n2", book_id: "b1", chapter: "系统二" }],
    } }) })));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><WorkspaceProvider><MemoryRouter><ReadingPage /></MemoryRouter></WorkspaceProvider></QueryClientProvider>);
    expect(await screen.findByRole("heading", { name: "读书" })).toBeInTheDocument();
    expect(screen.getByText("思考，快与慢")).toBeInTheDocument();
    expect(screen.getByText("20%" )).toBeInTheDocument();
    expect(screen.getByText(/2 篇笔记/)).toBeInTheDocument();
  });
});
