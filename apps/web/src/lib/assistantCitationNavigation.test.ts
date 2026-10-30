import { EnvironmentId, MessageId, ThreadId, type AssistantCitation } from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import {
  assistantCitationFromLocation,
  assistantCitationNavigation,
} from "./assistantCitationNavigation";

const citation: AssistantCitation = {
  version: 1,
  environmentId: EnvironmentId.make("environment-one"),
  threadId: ThreadId.make("thread-one"),
  messageId: MessageId.make("assistant-one"),
  text: "first line\n\tsecond line (with a #hash & spaces) 🚀",
  start: 12,
  end: 59,
  prefix: "Before:\n",
  suffix: "\nAfter.",
};

function createCitationRouter(initialEntry = "/environment-one/thread-one") {
  const root = createRootRoute();
  const thread = createRoute({ getParentRoute: () => root, path: "/$environmentId/$threadId" });
  return createRouter({
    routeTree: root.addChildren([thread]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("assistant citation navigation", () => {
  it("preserves large visualization element citations across navigation", async () => {
    const visual: AssistantCitation = {
      version: 2,
      environmentId: citation.environmentId,
      threadId: citation.threadId,
      text: "売".repeat(8000),
      comment: "問".repeat(8000),
      start: 0,
      end: 8000,
      prefix: "",
      suffix: "",
      htmlRender: {
        attachmentId: "visual-one",
        title: "売上",
        element: { selector: "#chart", tagName: "svg", markup: "図".repeat(8000) },
      },
    };
    const router = createCitationRouter();
    await router.navigate(assistantCitationNavigation(visual));
    expect(assistantCitationFromLocation(router.history.location.href)).toEqual(visual);
  });

  it("preserves encoded quote whitespace through router navigation and reload", async () => {
    const router = createCitationRouter();
    await router.navigate(assistantCitationNavigation(citation));

    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(citation);
    let href = router.history.location.href;
    for (let reload = 0; reload < 3; reload++) {
      const reloaded = createCitationRouter(href);
      await reloaded.load();
      await reloaded.navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: citation.environmentId, threadId: citation.threadId },
        hash: true,
        replace: true,
      });
      href = reloaded.history.location.href;
      expect(assistantCitationFromLocation(href)).toEqual(citation);
    }
  });

  it("reactivates an identical citation instead of deduplicating its navigation", async () => {
    const router = createCitationRouter();
    await router.navigate(assistantCitationNavigation(citation));
    const previous = router.state.location;
    await router.navigate(assistantCitationNavigation(citation));

    expect(router.state.location.href).toBe(previous.href);
    expect(router.state.location.state.assistantCitationActivation).not.toBe(
      previous.state.assistantCitationActivation,
    );
    expect(router.history.length).toBe(3);
    expect(assistantCitationFromLocation(router.state.location.href)).toEqual(citation);
  });
});
