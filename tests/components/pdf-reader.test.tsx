import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PdfReader } from "../../src/components/reading/PdfReader";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({ promise: new Promise(() => undefined) }),
}));

describe("PDF reader", () => {
  it("links a new note to the current page", async () => {
    const addNote = vi.fn();
    render(<PdfReader url="/api/books/b1/pdf" initialPage={7} totalPagesHint={100} onPageChange={() => undefined} onAddNote={addNote} />);
    await userEvent.click(screen.getByRole("button", { name: "添加当前页笔记" }));
    expect(addNote).toHaveBeenCalledWith(7);
  });

  it("keeps page navigation within the document bounds", async () => {
    const pageChange = vi.fn();
    render(<PdfReader url="/api/books/b1/pdf" initialPage={1} totalPagesHint={2} onPageChange={pageChange} onAddNote={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(pageChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(pageChange).toHaveBeenCalledWith(2);
  });
});
