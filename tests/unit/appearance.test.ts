import { describe, expect, it } from "vitest";
import { normalizeAppearance } from "../../src/appearance";

describe("appearance normalization", () => {
  it("falls back to iPhone system for missing, legacy and unknown values", () => {
    expect(normalizeAppearance(undefined)).toBe("ios");
    expect(normalizeAppearance(null)).toBe("ios");
    expect(normalizeAppearance("")).toBe("ios");
    expect(normalizeAppearance("glass")).toBe("ios");
    expect(normalizeAppearance("paper")).toBe("ios");
  });

  it("keeps the supported appearance values", () => {
    expect(normalizeAppearance("ios")).toBe("ios");
    expect(normalizeAppearance("liquid")).toBe("liquid");
    expect(normalizeAppearance("notebook")).toBe("notebook");
    expect(normalizeAppearance("neo")).toBe("neo");
  });
});
