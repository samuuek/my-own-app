import { describe, expect, it } from "vitest";
import { formatClock, remainingAt } from "../../src/features/workbench/model";

describe("workbench time model", () => {
  it("formats focus time as stable minutes and seconds", () => {
    expect(formatClock(1500)).toBe("25:00");
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(-4)).toBe("00:00");
  });

  it("decrements running snapshots and freezes paused snapshots", () => {
    expect(remainingAt({ status: "running", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:00.000Z" }, Date.parse("2026-08-15T01:00:30.000Z"))).toBe(90);
    expect(remainingAt({ status: "paused", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:00.000Z" }, Date.parse("2026-08-15T01:10:00.000Z"))).toBe(120);
  });

  it("does not increase remaining time when the browser clock moves backward", () => {
    expect(remainingAt({ status: "running", remainingSeconds: 120, snapshotAt: "2026-08-15T01:00:30.000Z" }, Date.parse("2026-08-15T01:00:00.000Z"))).toBe(120);
  });
});
