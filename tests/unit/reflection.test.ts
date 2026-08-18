import { describe, expect, it } from "vitest";
import { calculateReflectionCompletion, nextLocalDate, validateSourceCategory } from "../../server/reflection";

describe("reflection domain", () => {
  it("accepts the seven supported sources and rejects unknown values", () => {
    for (const value of ["work", "life", "reading", "conversation", "event", "inspiration", "other"]) {
      expect(() => validateSourceCategory(value)).not.toThrow();
    }
    expect(() => validateSourceCategory("social-media")).toThrow("思考来源无效");
  });

  it("calculates completion from the seven fixed reflection sections", () => {
    expect(calculateReflectionCompletion({ source_category: "work", work_summary: "完成项目", life_summary: "", gains: "有收获", problems: "", improvements: "", source_detail: "" })).toBe(43);
  });

  it("calculates the next local date across month and year boundaries", () => {
    expect(nextLocalDate("2026-08-31")).toBe("2026-09-01");
    expect(nextLocalDate("2026-12-31")).toBe("2027-01-01");
  });
});
