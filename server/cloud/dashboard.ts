import {
  buildDashboardFromCollections,
  dashboardCollectionNames,
  type DashboardCollections,
} from "../dashboard.js";
import type { FocusTimerSnapshot } from "../focus-timer.js";
import type { Entity } from "../store.js";
import type { CloudStore } from "./store.js";

type CloudFocusTimerReader = {
  current(): Promise<FocusTimerSnapshot | null>;
};

type OptionalSection = "importantDates" | "longTermGoals";

export async function buildCloudDashboard(
  store: CloudStore,
  date: string,
  focusTimers: CloudFocusTimerReader,
): Promise<Record<string, any>> {
  const sectionErrors: Record<string, string> = {};
  const collectionReads = dashboardCollectionNames.map(async (name) => {
    try {
      return [name, await store.list(name)] as const;
    } catch (error) {
      if (name !== "importantDates" && name !== "longTermGoals") throw error;
      sectionErrors[name satisfies OptionalSection] = error instanceof Error ? error.message : "数据不可用";
      return [name, [] as Entity[]] as const;
    }
  });
  const timerRead = focusTimers.current().catch((error: unknown) => {
    sectionErrors.focusTimer = error instanceof Error ? error.message : "数据不可用";
    return null;
  });
  const [entries, activeFocusTimer] = await Promise.all([Promise.all(collectionReads), timerRead]);
  const collections = Object.fromEntries(entries) as DashboardCollections;
  const dashboard = buildDashboardFromCollections(collections, date, activeFocusTimer);
  dashboard.sectionErrors = sectionErrors;
  return dashboard;
}
