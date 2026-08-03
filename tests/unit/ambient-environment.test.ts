import { describe, expect, it } from "vitest";
import { chooseAmbientScene } from "../../src/components/AmbientEnvironment";

describe("ambient environment selection", () => {
  it("uses one unified chromatic material across every light-mode module", () => {
    expect(chooseAmbientScene("media", "light", 10)).toBe("chromatic");
    expect(chooseAmbientScene("consulting", "light", 10)).toBe("chromatic");
    expect(chooseAmbientScene("development", "light", 10)).toBe("chromatic");
  });

  it("does not change the app palette by local time", () => {
    expect(chooseAmbientScene("dashboard", "light", 9)).toBe("chromatic");
    expect(chooseAmbientScene("dashboard", "light", 21)).toBe("chromatic");
  });

  it("uses the unified deep chromatic companion throughout dark mode", () => {
    expect(chooseAmbientScene("dashboard", "dark", 9)).toBe("chromatic-deep");
    expect(chooseAmbientScene("diet", "dark", 21)).toBe("chromatic-deep");
  });
});
