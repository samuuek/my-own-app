import { describe, expect, it } from "vitest";
import { calculateReadingStats, validateBookProgress } from "../../server/reading.js";

describe("reading domain", () => {
  it("rejects a current page beyond the known total", () => {
    expect(() => validateBookProgress(301, 300)).toThrow("当前页不能超过总页数");
  });

  it("summarizes pages, time, notes and completion", () => {
    const stats = calculateReadingStats(
      { current_page: 75, total_pages: 300, last_read_at: "2026-08-12T09:00:00.000Z" },
      [
        { start_page: 1, end_page: 20, duration_minutes: 30 },
        { start_page: 21, end_page: 75, duration_minutes: 65 },
      ],
      [{ id: "n1" }, { id: "n2" }],
    );

    expect(stats).toEqual({
      completion: 25,
      pagesRead: 75,
      minutesRead: 95,
      noteCount: 2,
      lastReadAt: "2026-08-12T09:00:00.000Z",
    });
  });
});
