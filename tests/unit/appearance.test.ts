import { describe, expect, it } from "vitest";
import { normalizeAppearance } from "../../src/appearance";

describe("appearance normalization", () => {
  it("falls back to liquid for missing, legacy and unknown values", () => {
    expect(normalizeAppearance(undefined)).toBe("liquid");
    expect(normalizeAppearance(null)).toBe("liquid");
    expect(normalizeAppearance("")).toBe("liquid");
    expect(normalizeAppearance("glass")).toBe("liquid");
    expect(normalizeAppearance("paper")).toBe("liquid");
  });

  it("keeps the supported appearance values", () => {
    expect(normalizeAppearance("liquid")).toBe("liquid");
    expect(normalizeAppearance("notebook")).toBe("notebook");
    expect(normalizeAppearance("neo")).toBe("neo");
  });
});
