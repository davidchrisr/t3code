import { RunId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { deriveMessagesTimelineRows, liveWorkEntryLabel } from "./MessagesTimeline.logic";

describe("long active tool groups", () => {
  it.each([
    { expanded: false, alwaysExpandThoughts: false },
    { expanded: true, alwaysExpandThoughts: false },
    { expanded: false, alwaysExpandThoughts: true },
    { expanded: true, alwaysExpandThoughts: true },
  ])(
    "preserves chronological order and the latest activity, %j",
    ({ expanded, alwaysExpandThoughts }) => {
      const runId = RunId.make("long-active-run");
      const createdAt = "2026-10-12T00:00:00Z";
      const timelineEntries = Array.from({ length: 1_000 }, (_, index) => ({
        id: `work-entry-${index}`,
        kind: "work" as const,
        createdAt,
        entry: {
          id: `work-${index}`,
          createdAt,
          runId,
          label: `Tool ${index}`,
          tone: index % 2 === 0 ? ("thinking" as const) : ("tool" as const),
          itemType: index % 2 === 0 ? ("reasoning" as const) : ("command_execution" as const),
          ...(index % 2 === 0 ? { detail: `Thought ${index}` } : {}),
          toolLifecycleStatus: index === 999 ? ("inProgress" as const) : ("completed" as const),
        },
      }));
      const rows = deriveMessagesTimelineRows({
        chatExpansion: {
          alwaysExpandTables: false,
          alwaysExpandThoughts,
          autoCollapseCompletedTurns: true,
        },
        timelineEntries,
        isWorking: true,
        runningRunId: runId,
        activeTurnStartedAt: createdAt,
        turnDiffSummaries: [],
        supportsConversationRollback: false,
        expandedWorkGroupIds: new Set(
          expanded ? [`work-group:work-entry-${alwaysExpandThoughts ? 999 : 0}`] : [],
        ),
      });
      const live = rows.find((row) => row.kind === "work-live");
      expect(live).toBeDefined();
      expect(live?.entry.id).toBe("work-999");
      expect(live && liveWorkEntryLabel(live.entry, undefined, live.active)).toContain("999");
      expect(live?.thought?.id).toBe(alwaysExpandThoughts ? undefined : "work-998");
      expect(live?.groupedEntries.map(({ id }) => id)).toEqual(
        (alwaysExpandThoughts ? timelineEntries.slice(-1) : timelineEntries).map(
          ({ entry }) => entry.id,
        ),
      );
      expect(live?.groupId).toBe(`work-group:work-entry-${alwaysExpandThoughts ? 999 : 0}`);
      const details = rows.filter((row) => row.kind === "work");
      expect(details).toHaveLength(
        alwaysExpandThoughts ? 999 + Number(expanded) : Number(expanded),
      );
      if (expanded) {
        expect(details.at(-1)?.groupedEntries).toEqual(live?.groupedEntries);
      }
      expect(
        rows.flatMap((row) =>
          row.kind === "work" || (row.kind === "work-live" && !row.expanded)
            ? row.groupedEntries.map((entry) => entry.id)
            : [],
        ),
      ).toEqual(timelineEntries.map(({ entry }) => entry.id));
    },
  );
});
