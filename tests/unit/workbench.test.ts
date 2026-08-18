// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveImportantDate } from "../../server/workbench.js";

describe("workbench calendar rules", () => {
  it("moves a recurring leap-day anniversary to the next valid local date", () => {
    expect(resolveImportantDate("2024-02-29", "yearly", "2026-03-01")).toEqual({
      displayDate: "2027-02-28",
      daysRemaining: 364,
      state: "future",
    });
  });

  it("labels today and overdue one-time dates without deleting them", () => {
    expect(resolveImportantDate("2026-08-15", "none", "2026-08-15")).toMatchObject({ daysRemaining: 0, state: "today" });
    expect(resolveImportantDate("2026-08-14", "none", "2026-08-15")).toMatchObject({ daysRemaining: -1, state: "overdue" });
  });

  it("keeps this year's recurring anniversary when it has not happened yet", () => {
    expect(resolveImportantDate("2020-12-20", "yearly", "2026-08-15")).toMatchObject({
      displayDate: "2026-12-20",
      state: "future",
    });
  });
});
