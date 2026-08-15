import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProgressOverview } from "../../src/features/workbench/ProgressOverview";
import { ImportantDatesPanel } from "../../src/features/workbench/ImportantDatesPanel";
import { LongTermGoalsPanel } from "../../src/features/workbench/LongTermGoalsPanel";
import { FocusTimerPanel } from "../../src/features/workbench/FocusTimerPanel";

afterEach(() => vi.useRealTimers());

describe("dashboard workbench panels", () => {
  it("shows an honest empty progress state", () => {
    render(<ProgressOverview date="2026-08-15" overview={{ completed: 0, total: 0, progress: 0, scheduledMinutes: 0 }} onAddTask={vi.fn()} />);
    expect(screen.getByText("今日进度")).toBeInTheDocument();
    expect(screen.getByText("还没有安排任务")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加今日任务" })).toBeInTheDocument();
  });

  it("renders accessible important-date actions", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(<ImportantDatesPanel
      items={[{ id: "date-1", name: "纪念日", target_date: "2026-08-15", displayDate: "2026-08-15", daysRemaining: 0, state: "today", recurrence: "yearly", color: "blue" }]}
      error={null}
      onRetry={vi.fn()}
      onAdd={vi.fn()}
      onEdit={onEdit}
      onDelete={onDelete}
      onMove={vi.fn()}
    />);
    expect(screen.getByText("纪念日")).toBeInTheDocument();
    expect(screen.getByText("今天")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "编辑纪念日" }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "date-1" }));
    await userEvent.click(screen.getByRole("button", { name: "删除纪念日" }));
    expect(onDelete).toHaveBeenCalled();
  });

  it("renders goal progress and completion state", () => {
    render(<LongTermGoalsPanel
      items={[{ id: "goal-1", name: "完成作品", progress: 65, status: "active", target_date: "2026-12-31" }]}
      error={null}
      onRetry={vi.fn()}
      onAdd={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
      onMove={vi.fn()}
    />);
    expect(screen.getByRole("progressbar", { name: "完成作品进度" })).toHaveAttribute("value", "65");
    expect(screen.getByText("65%")).toBeInTheDocument();
  });

  it("keeps paused timer time fixed and exposes resume and finish", async () => {
    const onResume = vi.fn();
    const onFinish = vi.fn();
    render(<FocusTimerPanel
      timer={{ id: "timer-1", status: "paused", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:00.000Z", actualSeconds: null }}
      taskTitle="整理首页"
      error={null}
      onRetry={vi.fn()}
      onPause={vi.fn()}
      onResume={onResume}
      onFinish={onFinish}
    />);
    expect(screen.getByText("02:00")).toBeInTheDocument();
    expect(screen.getByText("整理首页")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "继续专注" }));
    expect(onResume).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "结束专注" }));
    expect(onFinish).toHaveBeenCalled();
  });
});
