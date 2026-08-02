import { describe, expect, it } from "vitest";
import { buildMediaAnalytics } from "../../src/features/mediaAnalytics";

describe("media publishing analytics", () => {
  it("uses only published records with metrics and calculates totals, engagement and best content", () => {
    const result = buildMediaAnalytics([
      { id: "draft", title: "草稿", stage: "producing", views: 9999, likes: 999, comments: 99 },
      { id: "empty", title: "已发布但未填数据", stage: "published", published_at: "2026-08-01", views: null, likes: null, comments: null },
      { id: "one", title: "第一条视频", stage: "published", published_at: "2026-08-02", views: 1200, likes: 96, comments: 24 },
      { id: "two", title: "第二条表现更好的视频", stage: "published", published_at: "2026-08-03", views: 2800, likes: 210, comments: 70 },
    ]);

    expect(result.points.map((point) => point.id)).toEqual(["one", "two"]);
    expect(result.totals).toEqual({ views: 4000, likes: 306, comments: 94 });
    expect(result.engagementRate).toBeCloseTo(10);
    expect(result.best).toMatchObject({ id: "two", title: "第二条表现更好的视频", views: 2800 });
    expect(result.points[1].label).toBe("第二条表现更好的…");
  });
});
