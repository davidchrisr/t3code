import type { RunId } from "@t3tools/contracts";
import { useLayoutEffect, useState } from "react";

interface ThreadFeedDisclosures {
  readonly expandedWorkGroups: Record<string, boolean>;
  readonly expandedWorkRows: Record<string, boolean>;
  readonly expandedTurnIds: ReadonlySet<RunId>;
  readonly collapsedTurnIds: ReadonlySet<RunId>;
}

const rememberedDisclosures = new Map<string, ThreadFeedDisclosures>();

export function useThreadFeedDisclosures(threadKey: string) {
  const [disclosures, setDisclosures] = useState<ThreadFeedDisclosures>(
    () =>
      rememberedDisclosures.get(threadKey) ?? {
        expandedWorkGroups: {},
        expandedWorkRows: {},
        expandedTurnIds: new Set(),
        collapsedTurnIds: new Set(),
      },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Retain committed disclosure choices outside the feed for thread navigation and remounts.
  useLayoutEffect(() => {
    rememberedDisclosures.delete(threadKey);
    rememberedDisclosures.set(threadKey, disclosures);
    if (rememberedDisclosures.size > 100) {
      const oldest = rememberedDisclosures.keys().next().value;
      if (oldest !== undefined) rememberedDisclosures.delete(oldest);
    }
  }, [threadKey, disclosures]);

  return [disclosures, setDisclosures] as const;
}
