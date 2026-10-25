// @effect-diagnostics nodeBuiltinImport:off - Names download files on the shared disk.
/** The manager owns the single debugger attachment; the relay shares it. */
import {
  DesktopBrowserCommand,
  DesktopBrowserEvent,
  type DesktopBrowserEvent as DesktopBrowserEventType,
  type DesktopPreviewCaptureActivity,
  type DesktopPreviewPresentationInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { createCdpRelayConnection, type CdpRelayConnection } from "./CdpRelay.ts";
import { sendPageCommand } from "./GuestInput.ts";

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(DesktopBrowserEvent));
const decodeCommand = Schema.decodeUnknownOption(Schema.fromJsonString(DesktopBrowserCommand));
const lineEncoder = new TextEncoder();
const AGENT_INPUT_COMMAND =
  /"method":"(?:Input\.|Page\.navigate"|Runtime\.(?:evaluate|callFunctionOn)")/;
const AGENT_DOWNLOAD_WINDOW_MS = 5_000;

export interface DesktopBrowserTabKey {
  readonly threadId: string;
  readonly tabId: string;
}

export interface DesktopBrowserTabDebugger {
  readonly runtimeTabId: string;
  readonly webContents: Electron.WebContents;
  readonly debugger: Electron.Debugger;
}

const keyOf = ({ threadId, tabId }: DesktopBrowserTabKey) => `${threadId}\u0000${tabId}`;

interface AttachedTab {
  readonly key: DesktopBrowserTabKey;
  readonly debuggee: DesktopBrowserTabDebugger;
  relay: CdpRelayConnection | null;
  screenshotTurn: object | null;
  readonly waitingScreenshots: Array<() => void>;
  readonly captures: Map<string, { readonly start: () => void; readonly cancel: () => void }>;
  readonly presentation: { visible: boolean };
  downloadDirectory: string | null;
  pendingDownloadGuid: string | null;
  agentInputAt: number;
  readonly onMessage: (
    event: Electron.Event,
    method: string,
    params: unknown,
    sessionId: string,
  ) => void;
  readonly onNewDocument: () => void;
}

export class DesktopBrowserHost extends Context.Service<
  DesktopBrowserHost,
  {
    readonly events: Stream.Stream<Uint8Array>;
    readonly handleCommandLine: (line: string) => Effect.Effect<void>;
    readonly captureActivity: Stream.Stream<DesktopPreviewCaptureActivity>;
    readonly updatePresentation: (
      input: DesktopPreviewPresentationInput,
      rendererId: number | undefined,
    ) => void;
    readonly attach: (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => void;
    readonly detach: (key: DesktopBrowserTabKey) => void;
    readonly humanStartedDownload: (source: Electron.WebContents) => boolean;
    readonly placeDownload: (source: Electron.WebContents, item: Electron.DownloadItem) => boolean;
    readonly pointers: Stream.Stream<{
      readonly key: DesktopBrowserTabKey;
      readonly phase: "move" | "click";
      readonly x: number;
      readonly y: number;
    }>;
  }
>()("@t3tools/desktop/preview/DesktopBrowserHost") {}

export const make = Effect.gen(function* () {
  const outbox = yield* PubSub.unbounded<DesktopBrowserEventType>();
  const captureActivity = yield* PubSub.unbounded<DesktopPreviewCaptureActivity>();
  let captureSequence = 0;
  const pointers = yield* PubSub.sliding<{
    readonly key: DesktopBrowserTabKey;
    readonly phase: "move" | "click";
    readonly x: number;
    readonly y: number;
  }>(16);
  const runFork = Effect.runForkWith(yield* Effect.context<never>());
  const tabs = new Map<string, AttachedTab>();
  const presentations = new WeakMap<
    Electron.WebContents,
    { readonly tabKey: string; readonly runtimeTabId: string; visible: boolean }
  >();
  const emit = (event: DesktopBrowserEventType) => runFork(PubSub.publish(outbox, event));

  const nextScreenshot = (tab: AttachedTab) => {
    tab.screenshotTurn = null;
    tab.waitingScreenshots.shift()?.();
  };

  /**
   * Chromium below 157 crashes the whole app when a guest's renderer exits with a
   * screenshot copy in flight (crbug.com/567321049). Overlapping screenshots make that
   * far likelier, and one the server gave up on stays pending in Chromium, so each guest
   * gets one at a time. One queued by a relay released since then is dropped unsent.
   */
  const takeScreenshot = (
    tab: AttachedTab,
    relay: CdpRelayConnection,
    capture: () => Promise<unknown>,
  ) =>
    new Promise<unknown>((resolve, reject) => {
      const start = () => {
        if (tab.relay !== relay) {
          reject(new Error("The preview connection that asked for this screenshot closed."));
          nextScreenshot(tab);
          return;
        }
        const turn = {};
        tab.screenshotTurn = turn;
        const captureId = String(++captureSequence);
        const activity = { tabId: tab.debuggee.runtimeTabId, captureId };
        let started = false;
        const finish = () => {
          if (!tab.captures.delete(captureId)) return;
          runFork(PubSub.publish(captureActivity, { ...activity, active: false }));
          if (tab.screenshotTurn === turn) nextScreenshot(tab);
        };
        tab.captures.set(captureId, {
          start: () => {
            if (started) return;
            started = true;
            Promise.resolve().then(capture).finally(finish).then(resolve, reject);
          },
          cancel: () => {
            // Keep in-flight copies paintable until Chromium actually completes them.
            if (started) return;
            finish();
            reject(new Error("The preview connection that asked for this screenshot closed."));
          },
        });
        runFork(PubSub.publish(captureActivity, { ...activity, active: true }));
      };
      if (tab.screenshotTurn === null) start();
      else tab.waitingScreenshots.push(start);
    });

  const relayFor = (tab: AttachedTab) => {
    if (tab.relay) return tab.relay;
    const { webContents, debugger: debuggee } = tab.debuggee;
    const send = (method: string, params: Record<string, unknown>, sessionId?: string) =>
      sessionId === undefined
        ? sendPageCommand(webContents, debuggee, method, params)
        : debuggee.sendCommand(method, params, sessionId);
    const relay: CdpRelayConnection = createCdpRelayConnection(
      {
        send: (method, params, sessionId) =>
          method === "Page.captureScreenshot"
            ? takeScreenshot(tab, relay, () => send(method, params, sessionId))
            : send(method, params, sessionId),
        targetId: () =>
          debuggee
            .sendCommand("Target.getTargetInfo")
            .then((result: { targetInfo: { targetId: string } }) => result.targetInfo.targetId),
        url: () => webContents.getURL(),
        title: () => webContents.getTitle(),
        userAgent: () => webContents.getUserAgent(),
        setDownloadDirectory: (directory) => {
          tab.downloadDirectory = directory;
        },
      },
      (message) => {
        if (tab.relay === relay && tabs.get(keyOf(tab.key)) === tab) {
          emit({ type: "cdp", ...tab.key, message });
        }
      },
    );
    tab.relay = relay;
    return relay;
  };

  // CDP supplies the path before this runs; otherwise Electron opens a Save dialog.
  const placeDownload = (source: Electron.WebContents, item: Electron.DownloadItem) => {
    const tab = [...tabs.values()].find(
      (candidate) => candidate.debuggee.webContents === source && candidate.downloadDirectory,
    );
    if (!tab?.downloadDirectory || !tab.pendingDownloadGuid) return false;
    item.setSavePath(NodePath.join(tab.downloadDirectory, tab.pendingDownloadGuid));
    tab.pendingDownloadGuid = null;
    return true;
  };

  const detach = (key: DesktopBrowserTabKey) => {
    const id = keyOf(key);
    const tab = tabs.get(id);
    if (!tab) return;
    tabs.delete(id);
    tab.relay = null;
    for (const capture of tab.captures.values()) capture.cancel();
    tab.debuggee.debugger.off("message", tab.onMessage);
    tab.debuggee.webContents.off("did-navigate", tab.onNewDocument);
    emit({ type: "detached", ...key });
  };

  const attach = (key: DesktopBrowserTabKey, debuggee: DesktopBrowserTabDebugger) => {
    const id = keyOf(key);
    if (tabs.get(id)?.debuggee.webContents === debuggee.webContents) return;
    detach(key);
    const previousPresentation = presentations.get(debuggee.webContents);
    const presentation =
      !debuggee.webContents.isDestroyed() &&
      previousPresentation?.tabKey === id &&
      previousPresentation.runtimeTabId === debuggee.runtimeTabId
        ? previousPresentation
        : { tabKey: id, runtimeTabId: debuggee.runtimeTabId, visible: false };
    presentations.set(debuggee.webContents, presentation);
    const tab: AttachedTab = {
      key,
      debuggee,
      relay: null,
      screenshotTurn: null,
      waitingScreenshots: [],
      captures: new Map(),
      presentation,
      downloadDirectory: null,
      pendingDownloadGuid: null,
      agentInputAt: Number.NEGATIVE_INFINITY,
      onMessage: (_event, method, params, sessionId) => {
        if (method === "Browser.downloadWillBegin") {
          const guid = (params as { guid?: unknown } | undefined)?.guid;
          tab.pendingDownloadGuid = typeof guid === "string" ? guid : null;
        }
        tab.relay?.event(method, params, sessionId);
      },
      // A screenshot pending when the page loads a new document, a reload included, can
      // stay unanswered. A crashed page lands here once it reloads, well after its renderer died.
      onNewDocument: () => {
        const turn = tab.screenshotTurn;
        const previousCaptures = [...tab.captures.values()];
        for (const capture of previousCaptures) capture.cancel();
        if (turn !== null && tab.screenshotTurn === turn) nextScreenshot(tab);
      },
    };
    tabs.set(id, tab);
    debuggee.debugger.on("message", tab.onMessage);
    debuggee.webContents.on("did-navigate", tab.onNewDocument);
    emit({ type: "attached", ...key });
    if (presentation.visible) emit({ type: "visibility", ...key, visible: true });
  };

  const handleCommandLine = (line: string) =>
    Effect.sync(() => {
      const command = decodeCommand(line);
      if (Option.isNone(command)) return;
      const tab = tabs.get(keyOf(command.value));
      if (!tab) return;
      if (command.value.type === "pointer") {
        const { threadId, tabId, phase, x, y } = command.value;
        runFork(PubSub.publish(pointers, { key: { threadId, tabId }, phase, x, y }));
        return;
      }
      if (command.value.type === "release") {
        tab.relay = null;
        for (const capture of tab.captures.values()) capture.cancel();
        return;
      }
      if (AGENT_INPUT_COMMAND.test(command.value.message)) tab.agentInputAt = performance.now();
      relayFor(tab).receive(command.value.message);
    });

  const humanStartedDownload = (source: Electron.WebContents) => {
    const tab = [...tabs.values()].find((candidate) => candidate.debuggee.webContents === source);
    return tab !== undefined && performance.now() - tab.agentInputAt > AGENT_DOWNLOAD_WINDOW_MS;
  };

  const updatePresentation = (
    { tabId, visible, captureIds }: DesktopPreviewPresentationInput,
    rendererId: number | undefined,
  ) => {
    if (rendererId === undefined) return;
    const tab = [...tabs.values()].find(
      (tab) =>
        tab.debuggee.runtimeTabId === tabId &&
        !tab.debuggee.webContents.isDestroyed() &&
        tab.debuggee.webContents.hostWebContents?.id === rendererId,
    );
    if (!tab) return;
    if (tab.presentation.visible !== visible) {
      tab.presentation.visible = visible;
      emit({ type: "visibility", ...tab.key, visible });
    }
    for (const captureId of captureIds) tab.captures.get(captureId)?.start();
  };

  const announceAll = Effect.suspend(() =>
    Effect.forEach(
      [...tabs.values()],
      (tab) => {
        tab.relay = null;
        for (const capture of tab.captures.values()) capture.cancel();
        return PubSub.publish(outbox, { type: "attached", ...tab.key }).pipe(
          Effect.andThen(
            tab.presentation.visible
              ? PubSub.publish(outbox, { type: "visibility", ...tab.key, visible: true })
              : Effect.void,
          ),
        );
      },
      { discard: true },
    ),
  );

  return DesktopBrowserHost.of({
    captureActivity: Stream.fromPubSub(captureActivity),
    updatePresentation,
    pointers: Stream.fromPubSub(pointers),
    // Subscribes before announcing, so no attach falls between the two.
    events: Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(outbox);
        yield* announceAll;
        return Stream.fromSubscription(subscription);
      }),
    ).pipe(Stream.map((event) => lineEncoder.encode(`${encodeEvent(event)}\n`))),
    handleCommandLine,
    attach,
    detach,
    placeDownload,
    humanStartedDownload,
  });
});

export const layer = Layer.effect(DesktopBrowserHost, make);
