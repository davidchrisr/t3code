import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import type { AssistantCitationTarget } from "../components/chat/AssistantCitationSource";
import {
  failHtmlRenderCitationNavigation,
  HTML_RENDER_CITATION_NAVIGATION_TIMEOUT_MS,
  watchHtmlRenderCitationNavigation,
} from "./htmlRenderCitationNavigation";

function request(): AssistantCitationTarget {
  return {
    key: "request",
    citation: {
      version: 2,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      text: "quote",
      start: 0,
      end: 5,
      prefix: "",
      suffix: "",
      htmlRender: { attachmentId: "visual", title: "Chart" },
    },
    activationRef: { current: { scrolled: false, dismissed: false } },
    onComplete: vi.fn(),
  };
}

function fakeTimers() {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => vi.useRealTimers() };
}

describe("visualization source navigation failures", () => {
  it("finishes a failed asset request once without affecting another source", () => {
    const target = request();
    expect(failHtmlRenderCitationNavigation(target, "other-visual")).toBe(false);
    expect(target.onComplete).not.toHaveBeenCalled();
    expect(failHtmlRenderCitationNavigation(target, "visual")).toBe(true);
    expect(target.activationRef.current.dismissed).toBe(true);
    expect(target.onComplete).toHaveBeenCalledOnce();
    expect(failHtmlRenderCitationNavigation(target, "visual")).toBe(false);
    expect(target.onComplete).toHaveBeenCalledOnce();
  });

  it("terminates navigation when the page never answers", () => {
    using _timers = fakeTimers();
    const target = request();
    const onFailure = vi.fn();
    const dispose = watchHtmlRenderCitationNavigation({
      request: target,
      attachmentId: "visual",
      onFailure,
    });
    try {
      vi.advanceTimersByTime(HTML_RENDER_CITATION_NAVIGATION_TIMEOUT_MS);
      expect(target.onComplete).toHaveBeenCalledOnce();
      expect(target.activationRef.current.dismissed).toBe(true);
      expect(onFailure).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("keeps the original deadline when a row remounts", () => {
    using _timers = fakeTimers();
    const target = request();
    const onFailure = vi.fn();
    const dispose = watchHtmlRenderCitationNavigation({
      request: target,
      attachmentId: "visual",
      onFailure,
    });
    vi.advanceTimersByTime(6000);
    dispose();
    const disposeAgain = watchHtmlRenderCitationNavigation({
      request: target,
      attachmentId: "visual",
      onFailure,
    });
    try {
      vi.advanceTimersByTime(4000);
      expect(target.onComplete).toHaveBeenCalledOnce();
      expect(onFailure).toHaveBeenCalledOnce();
    } finally {
      disposeAgain();
    }
  });

  it.each(["completed", "dismissed", "unmounted"] as const)(
    "does not fail a %s request",
    (state) => {
      using _timers = fakeTimers();
      const target = request();
      const onFailure = vi.fn();
      const dispose = watchHtmlRenderCitationNavigation({
        request: target,
        attachmentId: "visual",
        onFailure,
      });
      if (state === "completed") target.activationRef.current.scrolled = true;
      if (state === "dismissed") target.activationRef.current.dismissed = true;
      if (state === "unmounted") dispose();
      try {
        vi.advanceTimersByTime(HTML_RENDER_CITATION_NAVIGATION_TIMEOUT_MS);
        expect(onFailure).not.toHaveBeenCalled();
        expect(target.onComplete).not.toHaveBeenCalled();
      } finally {
        dispose();
      }
    },
  );
});
