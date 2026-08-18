import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OnboardingModal } from "../../src/features/workbench/OnboardingModal";

describe("progress workbench onboarding", () => {
  it("opens with a focused welcome step and persists skip", async () => {
    const onSkip = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingModal open onSkip={onSkip} onComplete={vi.fn()} onCreateImportantDate={vi.fn()} onCreateGoal={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "欢迎使用新的进度工作台" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "跳过引导" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "跳过引导" }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("creates optional date and goal content before completing", async () => {
    const onCreateImportantDate = vi.fn().mockResolvedValue(undefined);
    const onCreateGoal = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingModal open onSkip={vi.fn()} onComplete={onComplete} onCreateImportantDate={onCreateImportantDate} onCreateGoal={onCreateGoal} />);

    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.type(screen.getByLabelText("重要日期名称"), "纪念日");
    await userEvent.type(screen.getByLabelText("重要日期"), "2026-10-01");
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(onCreateImportantDate).toHaveBeenCalledWith({ name: "纪念日", target_date: "2026-10-01", recurrence: "none", color: "blue" });

    await userEvent.type(screen.getByLabelText("目标名称"), "完成作品");
    await userEvent.type(screen.getByLabelText("目标日期"), "2026-12-31");
    await userEvent.clear(screen.getByLabelText("初始进度"));
    await userEvent.type(screen.getByLabelText("初始进度"), "20");
    await userEvent.click(screen.getByRole("button", { name: "完成引导" }));
    expect(onCreateGoal).toHaveBeenCalledWith({ name: "完成作品", target_date: "2026-12-31", progress: 20, notes: "", status: "active" });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("allows optional setup steps to be left empty", async () => {
    const onCreateImportantDate = vi.fn();
    const onCreateGoal = vi.fn();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingModal open onSkip={vi.fn()} onComplete={onComplete} onCreateImportantDate={onCreateImportantDate} onCreateGoal={onCreateGoal} />);

    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.click(screen.getByRole("button", { name: "下一步" }));
    await userEvent.click(screen.getByRole("button", { name: "完成引导" }));
    expect(onCreateImportantDate).not.toHaveBeenCalled();
    expect(onCreateGoal).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
