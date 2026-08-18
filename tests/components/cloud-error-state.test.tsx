import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspace, WorkspaceProvider } from "../../src/WorkspaceContext";

function CachedTask() {
  const { data } = useWorkspace();
  return <div>{data.planItems.map((item) => <span key={item.id}>{item.title}</span>)}</div>;
}

afterEach(() => vi.unstubAllGlobals());

describe("cloud refetch errors", () => {
  it("keeps cached workspace data visible and offers a retry after refetch fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { message: "云端暂时不可用" } }) } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["workspace"], {
      planItems: [{ id: "task-1", title: "保留的任务" }], settings: {}, trash: [],
    }, { updatedAt: 0 });
    render(<QueryClientProvider client={client}><WorkspaceProvider><CachedTask /></WorkspaceProvider></QueryClientProvider>);
    expect(screen.getByText("保留的任务")).toBeInTheDocument();
    expect(await screen.findByText(/刷新失败/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("保留的任务")).toBeInTheDocument();
  });
});
