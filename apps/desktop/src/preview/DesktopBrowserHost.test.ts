// @effect-diagnostics nodeBuiltinImport:off - Stands in for an Electron debugger.
import { describe, expect, it } from "@effect/vitest";
import { DesktopBrowserEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeEvents from "node:events";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(DesktopBrowserEvent));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCdpReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Number })),
);
const key = { threadId: "thread-1", tabId: "tab-1" };
/** Sends a page command whose id the fake debugger records as it receives it. */
const command = (
  host: DesktopBrowserHost.DesktopBrowserHost["Service"],
  id: number,
  method: string,
) =>
  host.handleCommandLine(
    encodeJson({
      type: "cdp",
      ...key,
      message: encodeJson({ id, method, params: { id }, sessionId: "t3-preview-page" }),
    }),
  );

const makeDebuggee = () => {
  const emitter = new NodeEvents.EventEmitter();
  let destroyed = false;
  const pending: Array<(error?: Error) => void> = [];
  const sent: Array<unknown> = [];
  const sendWaiters: Array<() => void> = [];
  const debuggee = Object.assign(emitter, {
    sendCommand: (method: string, params?: { id?: number }) =>
      new Promise((resolve, reject) => {
        if (method === "Target.getTargetInfo") {
          resolve({ targetInfo: { targetId: "GUEST" } });
          return;
        }
        sent.push(params?.id);
        pending.push((error) => (error ? reject(error) : resolve({ method })));
        sendWaiters.shift()?.();
      }),
  });
  const webContents = Object.assign(new NodeEvents.EventEmitter(), {
    isDestroyed: () => destroyed,
    getURL: () => "http://localhost/",
    getTitle: () => "Page",
    getUserAgent: () => "Electron",
  });
  Object.defineProperty(webContents, "hostWebContents", {
    get: () => {
      if (destroyed) throw new Error("Object has been destroyed");
      return { id: 7 };
    },
  });
  return {
    tab: {
      runtimeTabId: "runtime-tab-1",
      webContents: webContents as unknown as Electron.WebContents,
      debugger: debuggee as unknown as Electron.Debugger,
    },
    emit: (method: string, params: unknown) => emitter.emit("message", {}, method, params, ""),
    navigate: () => webContents.emit("did-navigate"),
    destroy: () => {
      destroyed = true;
    },
    /** Ids of the commands the debugger received, in order. */
    sent,
    nextSend: () => new Promise<void>((resolve) => sendWaiters.push(resolve)),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
    releaseFirst: () => pending.shift()?.(),
    failFirst: () => pending.shift()?.(new Error("Capture failed")),
  };
};

const takeEvents = (host: DesktopBrowserHost.DesktopBrowserHost["Service"], count: number) =>
  host.events.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((lines) => lines.map((line) => decodeEvent(new TextDecoder().decode(line)))),
  );

const renderer = Effect.fn("test.renderer")(function* (
  host: DesktopBrowserHost.DesktopBrowserHost["Service"],
  debuggee: ReturnType<typeof makeDebuggee>,
) {
  const requests = yield* host.captureActivity.pipe(
    Stream.filter((event) => event.active),
    Stream.toQueue({ capacity: "unbounded" }),
  );
  yield* Effect.yieldNow;
  return Effect.gen(function* () {
    const request = yield* Queue.take(requests);
    const sent = debuggee.nextSend();
    host.updatePresentation(
      {
        tabId: request.tabId,
        visible: false,
        captureIds: [request.captureId],
      },
      7,
    );
    yield* Effect.promise(() => sent);
  });
});

/**
 * Ids of the replies the host sends, in order. A screenshot's reply leaves after its turn
 * has passed on, so by then the next waiting screenshot, if any, has been sent. Subscribe
 * before sending commands: a new subscriber releases the tab's relay.
 */
const watchReplies = (host: DesktopBrowserHost.DesktopBrowserHost["Service"]) =>
  Effect.gen(function* () {
    const replies = yield* Queue.unbounded<number>();
    yield* host.events.pipe(
      Stream.map((line) => decodeEvent(new TextDecoder().decode(line))),
      Stream.runForEach((event) =>
        event.type === "cdp" ? Queue.offer(replies, decodeCdpReply(event.message).id) : Effect.void,
      ),
      Effect.forkScoped,
    );
    yield* Effect.yieldNow;
    return replies;
  });

describe("DesktopBrowserHost", () => {
  it.effect("ignores presentation updates after the guest is destroyed", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      debuggee.destroy();

      expect(() =>
        host.updatePresentation({ tabId: "runtime-tab-1", visible: false, captureIds: [] }, 7),
      ).not.toThrow();
    }),
  );

  it.effect("waits for the renderer before capturing and releases rendering after completion", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const activity = yield* Queue.unbounded<{
        tabId: string;
        captureId: string;
        active: boolean;
      }>();
      yield* host.captureActivity.pipe(
        Stream.runForEach((event) => Queue.offer(activity, event)),
        Effect.forkScoped,
      );
      const replies = yield* watchReplies(host);

      yield* command(host, 1, "Page.captureScreenshot");
      const requested = yield* Queue.take(activity);
      expect(requested).toMatchObject({ tabId: "runtime-tab-1", active: true });
      expect(debuggee.sent).toEqual([]);

      const sent = debuggee.nextSend();
      host.updatePresentation(
        {
          tabId: requested.tabId,
          visible: false,
          captureIds: [requested.captureId],
        },
        8,
      );
      expect(debuggee.sent).toEqual([]);
      host.updatePresentation(
        {
          tabId: requested.tabId,
          visible: false,
          captureIds: [requested.captureId],
        },
        7,
      );
      yield* Effect.promise(() => sent);
      expect(debuggee.sent).toEqual([1]);
      debuggee.releaseFirst();
      expect(yield* Queue.take(replies)).toBe(1);
      expect(yield* Queue.take(activity)).toEqual({ ...requested, active: false });
    }).pipe(Effect.scoped),
  );

  it.effect("reports native panel visibility without treating capture activity as visible", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      host.attach(key, makeDebuggee().tab);
      const events = yield* takeEvents(host, 3).pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      host.updatePresentation({ tabId: "runtime-tab-1", visible: true, captureIds: [] }, 7);
      host.updatePresentation({ tabId: "runtime-tab-1", visible: false, captureIds: [] }, 7);
      expect(yield* Fiber.join(events)).toEqual([
        { type: "attached", ...key },
        { type: "visibility", ...key, visible: true },
        { type: "visibility", ...key, visible: false },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("restores native panel visibility when the same guest debugger reattaches", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      host.updatePresentation({ tabId: "runtime-tab-1", visible: true, captureIds: [] }, 7);
      host.detach(key);

      const events = yield* host.events.pipe(
        Stream.map((line) => decodeEvent(new TextDecoder().decode(line))),
        Stream.takeUntil((event) => event.type === "detached"),
        Stream.runCollect,
        Effect.forkScoped({ startImmediately: true }),
      );
      host.attach(key, debuggee.tab);
      host.detach(key);

      expect(yield* Fiber.join(events)).toEqual([
        { type: "attached", ...key },
        { type: "visibility", ...key, visible: true },
        { type: "detached", ...key },
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect.each(["guest", "runtime tab", "server tab"] as const)(
    "does not restore native panel visibility after replacing the %s",
    (replacement) =>
      Effect.gen(function* () {
        const host = yield* DesktopBrowserHost.make;
        const debuggee = makeDebuggee();
        host.attach(key, debuggee.tab);
        host.updatePresentation({ tabId: "runtime-tab-1", visible: true, captureIds: [] }, 7);
        host.detach(key);

        const nextKey = replacement === "server tab" ? { ...key, tabId: "tab-2" } : key;
        const nextGuest =
          replacement === "guest"
            ? makeDebuggee().tab
            : replacement === "runtime tab"
              ? { ...debuggee.tab, runtimeTabId: "runtime-tab-2" }
              : debuggee.tab;
        const events = yield* host.events.pipe(
          Stream.map((line) => decodeEvent(new TextDecoder().decode(line))),
          Stream.takeUntil((event) => event.type === "detached"),
          Stream.runCollect,
          Effect.forkScoped({ startImmediately: true }),
        );
        host.attach(nextKey, nextGuest);
        host.detach(nextKey);

        expect(yield* Fiber.join(events)).toEqual([
          { type: "attached", ...nextKey },
          { type: "detached", ...nextKey },
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect.each(["release", "detach", "navigate"] as const)(
    "cancels a capture awaiting renderer readiness on %s",
    (reason) =>
      Effect.gen(function* () {
        const host = yield* DesktopBrowserHost.make;
        const debuggee = makeDebuggee();
        host.attach(key, debuggee.tab);
        const activity = yield* host.captureActivity.pipe(
          Stream.toQueue({ capacity: "unbounded" }),
        );
        yield* Effect.yieldNow;
        yield* command(host, 1, "Page.captureScreenshot");
        const request = yield* Queue.take(activity);
        if (reason === "release") {
          yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
        } else if (reason === "detach") host.detach(key);
        else debuggee.navigate();
        expect(yield* Queue.take(activity)).toEqual({ ...request, active: false });
        host.updatePresentation(
          {
            tabId: request.tabId,
            visible: false,
            captureIds: [request.captureId],
          },
          7,
        );
        expect(debuggee.sent).toEqual([]);
      }).pipe(Effect.scoped),
  );

  it.effect("releases rendering when screenshot capture rejects", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const replies = yield* watchReplies(host);
      const activity = yield* host.captureActivity.pipe(Stream.toQueue({ capacity: "unbounded" }));
      const acknowledge = yield* renderer(host, debuggee);
      yield* command(host, 1, "Page.captureScreenshot");
      yield* acknowledge;
      const requested = yield* Queue.take(activity);
      debuggee.failFirst();
      expect(yield* Queue.take(replies)).toBe(1);
      expect(yield* Queue.take(activity)).toEqual({ ...requested, active: false });
    }).pipe(Effect.scoped),
  );

  it.effect("announces tabs already attached to a backend that starts later", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      host.attach(key, makeDebuggee().tab);

      expect(yield* takeEvents(host, 1)).toEqual([{ type: "attached", ...key }]);
      expect(yield* takeEvents(host, 1)).toEqual([{ type: "attached", ...key }]);
    }),
  );

  it.effect("drops replies from a relay the server released", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const reader = yield* takeEvents(host, 2).pipe(Effect.forkScoped);
      const acknowledge = yield* renderer(host, debuggee);

      yield* Effect.yieldNow;
      const command = (id: number, method: string) =>
        host.handleCommandLine(
          encodeJson({
            type: "cdp",
            ...key,
            message: encodeJson({ id, method, sessionId: "t3-preview-page" }),
          }),
        );
      yield* command(1, "Page.captureScreenshot");
      yield* acknowledge;
      yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
      yield* command(2, "DOM.enable");
      debuggee.release();
      const [, reply] = yield* Fiber.join(reader);

      expect(reply).toMatchObject({ type: "cdp" });
      expect(decodeCdpReply((reply as { message: string }).message).id).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect("sends a page one screenshot at a time", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const replies = yield* watchReplies(host);
      const acknowledge = yield* renderer(host, debuggee);

      yield* command(host, 1, "Page.captureScreenshot");
      yield* acknowledge;
      yield* command(host, 2, "Page.captureScreenshot");
      yield* command(host, 3, "DOM.enable");
      expect(debuggee.sent).toEqual([1, 3]);

      debuggee.releaseFirst();
      expect(yield* Queue.take(replies)).toBe(1);
      yield* acknowledge;
      expect(debuggee.sent).toEqual([1, 3, 2]);
    }).pipe(Effect.scoped),
  );

  it.effect("stops waiting on a screenshot the page navigated away from", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const replies = yield* watchReplies(host);
      const acknowledge = yield* renderer(host, debuggee);

      yield* command(host, 1, "Page.captureScreenshot");
      yield* acknowledge;
      yield* command(host, 2, "Page.captureScreenshot");
      yield* command(host, 3, "Page.captureScreenshot");
      debuggee.navigate();
      yield* acknowledge;
      expect(debuggee.sent).toEqual([1, 2]);

      // The superseded screenshot answering late must not start a third beside the second.
      debuggee.releaseFirst();
      expect(yield* Queue.take(replies)).toBe(1);
      expect(debuggee.sent).toEqual([1, 2]);

      debuggee.releaseFirst();
      expect(yield* Queue.take(replies)).toBe(2);
      yield* acknowledge;
      expect(debuggee.sent).toEqual([1, 2, 3]);
    }).pipe(Effect.scoped),
  );

  it.effect("drops screenshots a released relay left waiting", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const acknowledge = yield* renderer(host, debuggee);

      yield* command(host, 1, "Page.captureScreenshot");
      yield* acknowledge;
      yield* command(host, 2, "Page.captureScreenshot");
      yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
      yield* command(host, 3, "Page.captureScreenshot");
      expect(debuggee.sent).toEqual([1]);

      debuggee.release();
      yield* acknowledge;
      expect(debuggee.sent).toEqual([1, 3]);
    }).pipe(Effect.scoped),
  );

  it.effect("saves a server tab's download under its CDP guid where the server asked", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const paths: Array<string> = [];
      const item = {
        setSavePath: (path: string) => void paths.push(path),
      } as unknown as Electron.DownloadItem;

      expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(false);
      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({
            id: 1,
            method: "Browser.setDownloadBehavior",
            params: { behavior: "allowAndName", downloadPath: "/srv/downloads" },
          }),
        }),
      );
      debuggee.emit("Browser.downloadWillBegin", { guid: "guid-1", suggestedFilename: "r.csv" });
      expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(true);
      expect(paths).toEqual(["/srv/downloads/guid-1"]);
    }),
  );

  it.effect("tells a download the person clicked from one the agent's input started", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);

      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({ id: 1, method: "DOM.getDocument", params: {} }),
        }),
      );
      expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(true);
      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({
            id: 2,
            method: "Input.dispatchMouseEvent",
            params: { type: "mousePressed", x: 1, y: 1 },
          }),
        }),
      );
      expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(false);
    }),
  );
});
