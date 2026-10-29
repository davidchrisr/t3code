import { describe, expect, it } from "vite-plus/test";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { createRecentThreadCycle } from "./recentThreadCycle";
import { buildThreadRouteParams } from "./threadRoutes";

async function deferredThreadRouter() {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const root = createRootRoute();
  const thread = createRoute({
    getParentRoute: () => root,
    path: "/$environmentId/$threadId",
    loader: ({ params }) => (params.threadId === "b" ? pending : undefined),
  });
  const router = createRouter({
    routeTree: root.addChildren([thread]),
    history: createMemoryHistory({ initialEntries: ["/local/a"] }),
  });
  await router.load();
  return { router, release };
}

describe("recent thread cycling", () => {
  it("cycles in visit order while navigation changes the current thread and ranking", () => {
    const cycle = createRecentThreadCycle(() => {});
    cycle.visit("a");
    cycle.visit("b");
    cycle.visit("c");
    cycle.visit("a");

    expect(cycle.next(["a", "c", "b"], "a")).toBe("c");
    cycle.visit("c");
    expect(cycle.next(["c", "a", "b"], "c")).toBe("b");
    cycle.visit("b");
    expect(cycle.next(["b", "c", "a"], "b")).toBe("a");
  });

  it("commits only the final selection when the modifier is released", () => {
    const cycle = createRecentThreadCycle(() => {});
    expect(cycle.next(["a", "b", "c"], "a")).toBe("b");
    cycle.visit("b");
    expect(cycle.next(["b", "a", "c"], "b")).toBe("c");
    cycle.visit("c");
    cycle.finish();

    expect(cycle.next(["c", "b", "a"], "c")).toBe("a");
    cycle.finish();
    expect(cycle.next(["a", "c", "b"], "a")).toBe("c");
  });

  it("advances through rapid presses before the route updates", () => {
    const cycle = createRecentThreadCycle(() => {});
    expect(cycle.next(["a", "b", "c"], "a")).toBe("b");
    expect(cycle.next(["a", "b", "c"], "a")).toBe("c");
  });

  it("skips removed threads and preserves environment identity", () => {
    const cycle = createRecentThreadCycle(() => {});
    expect(cycle.next(["local:a", "remote:a", "local:b"], "local:a")).toBe("remote:a");
    expect(cycle.next(["local:a", "remote:a"], "remote:a")).toBe("local:a");
    cycle.finish();
    expect(cycle.next(["local:a", "local:b"], "local:a")).toBe("local:b");
  });

  it("handles an empty history and a visit from outside the cycle", () => {
    const cycle = createRecentThreadCycle(() => {});
    expect(cycle.next([], null)).toBeNull();
    cycle.finish();
    cycle.visit("a");
    cycle.visit("b");
    expect(cycle.next(["a", "b"], "b")).toBe("a");
    cycle.finish();
    cycle.visit("b");
    expect(cycle.next(["a", "b"], "b")).toBe("a");
  });

  it("opens the most recent thread from a non-thread route after navigation is acknowledged", () => {
    const cycle = createRecentThreadCycle(() => {});
    expect(cycle.next(["a", "b"], "a")).toBe("b");
    cycle.visit("b");
    cycle.finish();

    expect(cycle.next(["b", "a"], null)).toBe("b");
  });

  it("supersedes pending navigation when rapid cycling wraps to the rendered thread", async () => {
    const { router, release } = await deferredThreadRouter();
    const navigations: Promise<void>[] = [];
    const cycle = createRecentThreadCycle((key) => {
      navigations.push(
        router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(parseScopedThreadKey(key)!),
        }),
      );
    });
    expect(cycle.next(["local:a", "local:b"], "local:a")).toBe("local:b");
    expect(cycle.next(["local:a", "local:b"], "local:a")).toBe("local:a");
    cycle.finish();
    release();
    await Promise.all(navigations);
    expect(router.state.location.pathname).toBe("/local/a");
  });

  it("starts a new cycle from the committed destination before navigation settles", async () => {
    const { router, release } = await deferredThreadRouter();
    const navigations: Promise<void>[] = [];
    const requested: string[] = [];
    const cycle = createRecentThreadCycle((key) => {
      requested.push(key);
      navigations.push(
        router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(parseScopedThreadKey(key)!),
        }),
      );
    });
    try {
      expect(cycle.next(["local:a", "local:b", "local:c"], "local:a")).toBe("local:b");
      cycle.finish();
      expect(cycle.next(["local:a", "local:b", "local:c"], "local:a")).toBe("local:a");
      cycle.finish();
      expect(requested).toEqual(["local:b", "local:a"]);
    } finally {
      release();
      await Promise.all(navigations);
    }
    expect(router.state.location.pathname).toBe("/local/a");
  });

  it("commits a modifier release before navigation settles", async () => {
    const { router, release } = await deferredThreadRouter();
    const navigations: Promise<void>[] = [];
    const cycle = createRecentThreadCycle((key) => {
      navigations.push(
        router.navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(parseScopedThreadKey(key)!),
        }),
      );
    });
    expect(cycle.next(["local:a", "local:b", "local:c"], "local:a")).toBe("local:b");
    cycle.finish();
    release();
    await Promise.all(navigations);
    expect(router.state.location.pathname).toBe("/local/b");
    cycle.visit("local:b");
    expect(cycle.next(["local:b", "local:a", "local:c"], "local:b")).toBe("local:a");
    await Promise.all(navigations);
  });
});
