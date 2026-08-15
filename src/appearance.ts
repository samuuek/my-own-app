export type Appearance = "ios" | "liquid" | "notebook" | "neo";

export function normalizeAppearance(value: unknown): Appearance {
  return value === "ios" || value === "liquid" || value === "notebook" || value === "neo" ? value : "ios";
}
