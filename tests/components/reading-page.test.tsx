import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingPage } from "../../src/pages/ReadingPage";
import { WorkspaceProvider } from "../../src/WorkspaceContext";

const uploadMock = vi.hoisted(() => vi.fn());
vi.mock("@vercel/blob/client", () => ({ upload: uploadMock }));

afterEach(() => { vi.unstubAllGlobals(); uploadMock.mockReset(); });

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

  it("uploads PDFs directly to private Blob instead of sending the file through the app function", async () => {
    uploadMock.mockResolvedValue({ pathname: "reading/books/b1/book-random.pdf", contentType: "application/pdf" });
    const state = {
      planItems: [], importantDates: [], longTermGoals: [], focusTimers: [], quickMemos: [], mediaContents: [], devProjects: [], devMilestones: [], devWorkItems: [], devLogs: [], clients: [], consultingProjects: [], consultingInteractions: [], consultingDeliverables: [], consultingFollowups: [], consultingTimeEntries: [], workoutTemplates: [], workoutTemplateExercises: [], workouts: [], workoutExercises: [], workoutSets: [], bodyMetrics: [], nutritionTargets: [], foods: [], meals: [], mealItems: [], entertainmentItems: [], playSessions: [], settings: {}, trash: [],
      books: [{ id: "b1", title: "Cloud book", status: "reading", current_page: 0, total_pages: 100 }], readingSessions: [], readingNotes: [], dailyReflections: [], reflectionActions: [], thoughtNotes: [],
    };
    const fetchMock = vi.fn(async (...args: [input?: RequestInfo | URL, init?: RequestInit]) => {
      void args;
      return { ok: true, status: 200, json: async () => ({ data: state }) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={client}><WorkspaceProvider><MemoryRouter initialEntries={["/reading/b1"]}>
        <Routes><Route path="/reading/:bookId" element={<ReadingPage />} /></Routes>
      </MemoryRouter></WorkspaceProvider></QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "Cloud book" })).toBeInTheDocument();
    const input = rendered.container.querySelector('input[type="file"][accept*="pdf"]') as HTMLInputElement;
    const file = new File(["%PDF-1.7"], "cloud.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    await waitFor(() => expect(uploadMock).toHaveBeenCalledWith(
      "reading/books/b1/book.pdf",
      file,
      {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        clientPayload: JSON.stringify({ bookId: "b1", kind: "pdf", contentType: "application/pdf", originalName: "cloud.pdf" }),
        multipart: true,
      },
    ));
    expect(fetchMock.mock.calls.some(([inputValue, init]) => String(inputValue) === "/api/books/b1/pdf" && init?.method === "PUT")).toBe(false);
  });
});
