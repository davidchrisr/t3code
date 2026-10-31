import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";

import { threadWorkLogNeedsMeasurement } from "./thread-feed-item-size";

describe("work-log row measurement", () => {
  const command = {
    id: "command",
    prominent: false,
    workEntry: {
      id: "command",
      createdAt: "2026-10-31T00:00:00Z",
      label: "Run command",
      tone: "tool" as const,
      itemType: "command_execution" as const,
    },
  };

  it.each([1, 2])("measures automatically expanded output for %i commands", (count) => {
    const activities = Array.from({ length: count }, (_, index) => ({
      ...command,
      id: `command-${index}`,
    }));
    for (const commandExpansion of ["collapsed", "commands", "full"] as const) {
      const settings = { ...DEFAULT_CLIENT_SETTINGS, commandExpansion };
      expect(threadWorkLogNeedsMeasurement(activities, {}, settings)).toBe(
        commandExpansion === "full",
      );
      const collapsed = Object.fromEntries(activities.map(({ id }) => [id, false]));
      expect(threadWorkLogNeedsMeasurement(activities, collapsed, settings)).toBe(false);
      expect(
        threadWorkLogNeedsMeasurement(activities, { ...collapsed, "command-0": true }, settings),
      ).toBe(true);
      if (count > 1) {
        expect(threadWorkLogNeedsMeasurement(activities, { "command-0": false }, settings)).toBe(
          commandExpansion === "full",
        );
      }
    }
  });

  it("keeps thoughts independent of command expansion and measures prominent rows", () => {
    const thought = {
      ...command,
      id: "thought",
      workEntry: {
        ...command.workEntry,
        tone: "thinking" as const,
        itemType: "reasoning" as const,
      },
    };
    for (const commandExpansion of ["collapsed", "commands", "full"] as const) {
      for (const alwaysExpandThoughts of [false, true]) {
        const settings = { ...DEFAULT_CLIENT_SETTINGS, commandExpansion, alwaysExpandThoughts };
        expect(threadWorkLogNeedsMeasurement([thought], {}, settings)).toBe(alwaysExpandThoughts);
        expect(threadWorkLogNeedsMeasurement([thought], { thought: false }, settings)).toBe(false);
        expect(
          threadWorkLogNeedsMeasurement(
            [{ ...command, prominent: true }],
            { command: false },
            settings,
          ),
        ).toBe(true);
      }
    }
  });
});
