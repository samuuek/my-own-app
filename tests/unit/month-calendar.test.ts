import { describe, expect, it } from "vitest";
import { buildMonthDays, shiftMonth } from "../../src/components/MonthCalendar";

describe("month calendar", () => {
  it("builds six Monday-first weeks including adjacent month days", () => {
    const days = buildMonthDays("2026-08");
    expect(days).toHaveLength(42);
    expect(days[0]).toEqual({ date: "2026-07-27", inMonth: false });
    expect(days[5]).toEqual({ date: "2026-08-01", inMonth: true });
    expect(days.at(-1)).toEqual({ date: "2026-09-06", inMonth: false });
  });

  it("moves across year boundaries", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
});
