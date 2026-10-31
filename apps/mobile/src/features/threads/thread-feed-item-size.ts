import { THREAD_WORK_ROW_MIN_HEIGHT } from "../../lib/layout";
import type { ThreadFeedActivity, ThreadFeedEntry } from "../../lib/threadActivity";
import type { ChatExpansionSettings } from "@t3tools/contracts/settings";
import { workEntryExpandedByDefault } from "@t3tools/client-runtime/work-log/presentation";

// Content-driven rows must be measured by LegendList: returning a fixed size
// makes the list skip native measurement entirely.
const TURN_FOLD_HEIGHT = 42;
const WORK_GROUP_TOGGLE_HEIGHT = THREAD_WORK_ROW_MIN_HEIGHT;

export function threadWorkLogNeedsMeasurement(
  activities: ReadonlyArray<Pick<ThreadFeedActivity, "id" | "prominent" | "workEntry">>,
  expandedRows: Readonly<Record<string, boolean>>,
  chatExpansion: ChatExpansionSettings,
): boolean {
  return activities.some(
    (activity) =>
      activity.prominent ||
      (expandedRows[activity.id] ?? workEntryExpandedByDefault(activity.workEntry, chatExpansion)),
  );
}

export function resolveThreadFeedFixedItemSize(
  entryType: ThreadFeedEntry["type"],
): number | undefined {
  switch (entryType) {
    case "run-fold":
      return TURN_FOLD_HEIGHT;
    case "work-toggle":
      return WORK_GROUP_TOGGLE_HEIGHT;
    case "activity-group":
    case "message":
      return undefined;
  }
}
