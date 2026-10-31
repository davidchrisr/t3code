import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import { scopedThreadKey } from "../lib/scopedEntities";
import { useThreadFeedDisclosures } from "./use-thread-feed-disclosures";

it.each([false, true])(
  "restores manual disclosures after a thread remount with automatic collapsing %s",
  async (autoCollapse) => {
    using _globals = { [Symbol.dispose]: () => vi.unstubAllGlobals() };
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const threadId = ThreadId.make(`disclosures-${autoCollapse}`);
    const threadKey = scopedThreadKey(EnvironmentId.make("environment-a"), threadId);
    const otherEnvironmentKey = scopedThreadKey(EnvironmentId.make("environment-b"), threadId);
    const otherThreadKey = scopedThreadKey(
      EnvironmentId.make("environment-a"),
      ThreadId.make(`other-disclosures-${autoCollapse}`),
    );
    const runId = RunId.make("run-a");
    let current!: ReturnType<typeof useThreadFeedDisclosures>;
    function Probe({ scope }: { scope: string }) {
      const disclosures = useThreadFeedDisclosures(scope);
      useLayoutEffect(() => {
        current = disclosures;
      });
      return null;
    }

    const root = createRoot(document.createElement("div"));
    try {
      await act(async () => root.render(<Probe key={threadKey} scope={threadKey} />));
      await act(async () => {
        current[1]({
          expandedWorkGroups: { tools: true },
          expandedWorkRows: { thought: false, tool: true },
          expandedTurnIds: new Set(autoCollapse ? [runId] : []),
          collapsedTurnIds: new Set(autoCollapse ? [] : [runId]),
        });
      });
      const saved = current[0];

      for (const scope of [otherThreadKey, otherEnvironmentKey]) {
        await act(async () => root.render(<Probe key={scope} scope={scope} />));
        expect(current[0].expandedTurnIds.size).toBe(0);
        expect(current[0].collapsedTurnIds.size).toBe(0);
        expect(current[0].expandedWorkRows).toEqual({});
      }

      await act(async () => root.render(<Probe key={threadKey} scope={threadKey} />));
      expect(current[0]).toEqual(saved);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
