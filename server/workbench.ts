import { ValidationError } from "./errors.js";
import type { Entity } from "./store.js";

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function validateWorkbenchEntity(name: string, current: Entity | null, input: Entity): void {
  const merged = { ...(current ?? {}), ...input };
  if (name === "importantDates") {
    if (!String(merged.name ?? "").trim()) throw new ValidationError("请填写日期名称");
    if (!isIsoDate(merged.target_date)) throw new ValidationError("请选择有效日期");
    if (!["none", "yearly"].includes(merged.recurrence ?? "none")) throw new ValidationError("重复方式无效");
    if (!["blue", "green", "orange", "red"].includes(merged.color ?? "blue")) throw new ValidationError("日期颜色无效");
  }
  if (name === "longTermGoals") {
    if (!String(merged.name ?? "").trim()) throw new ValidationError("请填写目标名称");
    if (merged.target_date && !isIsoDate(merged.target_date)) throw new ValidationError("请选择有效目标日期");
    const progress = Number(merged.progress ?? 0);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new ValidationError("目标进度必须是 0 到 100 的整数");
    if (!["active", "completed"].includes(merged.status ?? "active")) throw new ValidationError("目标状态无效");
  }
}

export type ImportantDateResolution = {
  displayDate: string;
  daysRemaining: number;
  state: "future" | "today" | "overdue";
};

export function resolveImportantDate(
  targetDate: string,
  recurrence: "none" | "yearly",
  today: string,
): ImportantDateResolution {
  let displayDate = targetDate;
  if (recurrence === "yearly" && targetDate < today) {
    const [, month, day] = targetDate.split("-").map(Number);
    let year = Number(today.slice(0, 4));
    const anniversary = (candidateYear: number) => {
      const candidate = `${candidateYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return month === 2 && day === 29 && !isIsoDate(candidate) ? `${candidateYear}-02-28` : candidate;
    };
    displayDate = anniversary(year);
    if (displayDate < today) displayDate = anniversary(++year);
  }
  const daysRemaining = Math.round(
    (Date.parse(`${displayDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  return {
    displayDate,
    daysRemaining,
    state: daysRemaining > 0 ? "future" : daysRemaining === 0 ? "today" : "overdue",
  };
}
