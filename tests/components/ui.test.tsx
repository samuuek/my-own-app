import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog, EmptyState, EntityForm, ErrorState, Modal, Skeleton } from "../../src/components/ui";

function ModalHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>打开弹窗</button>
      <Modal open={open} title="键盘操作" description="验证焦点不会离开弹窗" onClose={() => setOpen(false)}>
        <button>继续操作</button>
      </Modal>
    </>
  );
}

describe("shared interaction components", () => {
  it("validates required fields and converts numeric input before saving", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async () => undefined);
    render(<EntityForm fields={[{ name: "title", label: "标题", required: true }, { name: "minutes", label: "分钟", type: "number" }]} onSubmit={onSubmit} onCancel={() => undefined} />);
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(await screen.findByText("请填写此项")).toBeInTheDocument();
    await user.type(screen.getByLabelText(/标题/), "专注开发");
    await user.type(screen.getByLabelText(/分钟/), "45");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(onSubmit).toHaveBeenCalledWith({ title: "专注开发", minutes: 45 });
  });

  it("provides explicit empty, loading and error states", () => {
    const { rerender } = render(<EmptyState title="没有记录" description="添加第一条记录" />);
    expect(screen.getByText("没有记录")).toBeInTheDocument();
    rerender(<Skeleton lines={3} />);
    expect(screen.getByLabelText("正在加载").children).toHaveLength(3);
    rerender(<ErrorState message="数据文件不可写" />);
    expect(screen.getByRole("alert")).toHaveTextContent("数据文件不可写");
  });

  it("does not run a destructive action when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn(async () => undefined);
    render(<ConfirmDialog open title="永久删除这条记录？" description="删除后无法恢复" confirmLabel="永久删除" danger onClose={onClose} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("traps keyboard focus inside a modal and restores it after closing", async () => {
    const user = userEvent.setup();
    render(<ModalHarness />);
    const trigger = screen.getByRole("button", { name: "打开弹窗" });
    await user.click(trigger);
    const close = screen.getByRole("button", { name: "关闭" });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "继续操作" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
