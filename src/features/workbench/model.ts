import type { FocusTimerSnapshot } from "../../types";

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function remainingAt(
  snapshot: Pick<FocusTimerSnapshot, "status" | "remainingSeconds" | "snapshotAt">,
  nowMs: number,
): number {
  if (snapshot.status !== "running") return snapshot.remainingSeconds;
  const elapsed = Math.max(0, Math.floor((nowMs - Date.parse(snapshot.snapshotAt)) / 1000));
  return Math.max(0, snapshot.remainingSeconds - elapsed);
}
