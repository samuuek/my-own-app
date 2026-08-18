const sourceCategories = new Set(["work", "life", "reading", "conversation", "event", "inspiration", "other"]);

export class ReflectionValidationError extends Error {
  statusCode = 400;
}

export function validateSourceCategory(value: unknown): void {
  if (!sourceCategories.has(String(value))) throw new ReflectionValidationError("思考来源无效");
}

export function calculateReflectionCompletion(reflection: Record<string, unknown>): number {
  const fields = ["source_category", "source_detail", "work_summary", "life_summary", "gains", "problems", "improvements"];
  const completed = fields.filter((field) => String(reflection[field] ?? "").trim()).length;
  return Math.round(completed / fields.length * 100);
}

export function nextLocalDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}
