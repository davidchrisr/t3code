import {
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type DeviceServiceState,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import type { ThreadPreviewState } from "~/previewStateStore";
import { selectThreadRightPanelState, useRightPanelStore } from "~/rightPanelStore";
import { useAgentOpenedPreviews } from "./useAgentOpenedPreviews";

const settings = vi.hoisted(() => ({ autoShow: true, hydrated: true }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (
    select: (value: Pick<ClientSettings, "browserAutoShowFloatingPreview">) => unknown,
  ) => select({ browserAutoShowFloatingPreview: settings.autoShow }),
  useClientSettingsHydrated: () => settings.hydrated,
}));

const threadRef = {
  environmentId: EnvironmentId.make("floating-preview-environment"),
  threadId: ThreadId.make("floating-preview-thread"),
};
const devices: DeviceServiceState = {
  hosts: [],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: true,
  agentAccessEnabled: true,
  hubBasePath: "/api/device-hub",
  revision: 0,
};
const previewState: ThreadPreviewState = {
  snapshot: null,
  sessions: {},
  suppressedTabIds: new Set(),
  activeTabId: null,
  desktopOverlay: null,
  desktopByTabId: {},
  recentlySeenUrls: [],
  listLoaded: true,
  serverEpoch: "epoch",
  serverRevision: 0,
};
const session: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab",
  navStatus: { _tag: "Success", url: "https://example.com", title: "Example" },
  canGoBack: false,
  canGoForward: false,
  runtime: "server",
  reveal: true,
  revealRequest: { id: "reveal-1", force: true },
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const openedDevice: DeviceServiceState = {
  ...devices,
  devices: [
    {
      hostId: "local",
      id: "phone",
      name: "Phone",
      platform: "ios",
      version: "iOS 19",
      booted: true,
      physical: false,
    },
  ],
  sessions: [
    {
      threadId: threadRef.threadId,
      hostId: "local",
      deviceId: "phone",
      platform: "ios",
      openedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function setup() {
  settings.autoShow = true;
  settings.hydrated = true;
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useRightPanelStore.setState({ byThreadKey: {} });
}

const noSessions: ReadonlyArray<PreviewSessionSnapshot> = [];

function Harness({
  sessions = noSessions,
  deviceState = devices,
}: {
  readonly sessions?: ReadonlyArray<PreviewSessionSnapshot>;
  readonly deviceState?: DeviceServiceState;
}) {
  useAgentOpenedPreviews({
    threadRef,
    deviceState,
    deviceStateLoaded: true,
    previewState: {
      ...previewState,
      sessions: Object.fromEntries(sessions.map((s) => [s.tabId, s])),
    },
    serverBrowserAvailable: true,
    panelSurfaces: [],
    miniPlayerSource: null,
    sheetLayout: false,
  });
  return null;
}

describe("agent-opened floating previews", () => {
  it("honors the disabled setting even for a forced reveal", async () => {
    setup();
    settings.autoShow = false;
    await using screen = await render(<Harness />);
    await screen.rerender(<Harness sessions={[session]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  });

  it("opens a new revealed browser when automatic previews are enabled", async () => {
    setup();
    await using screen = await render(<Harness />);
    await screen.rerender(<Harness sessions={[session]} />);
    expect(Object.values(usePreviewMiniPlayerStore.getState().byThreadKey)).toMatchObject([
      { source: { kind: "browser", tabId: session.tabId } },
    ]);
  });

  it("waits for saved settings before opening a browser", async () => {
    setup();
    settings.hydrated = false;
    await using screen = await render(<Harness />);
    await screen.rerender(<Harness sessions={[session]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
    settings.autoShow = false;
    settings.hydrated = true;
    await screen.rerender(<Harness sessions={[session]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  });

  it("opens a browser revealed during settings loading once automatic previews are enabled", async () => {
    setup();
    settings.hydrated = false;
    await using screen = await render(<Harness />);
    await screen.rerender(<Harness sessions={[session]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});

    settings.hydrated = true;
    await screen.rerender(<Harness sessions={[session]} />);
    expect(Object.values(usePreviewMiniPlayerStore.getState().byThreadKey)).toMatchObject([
      { source: { kind: "browser", tabId: session.tabId } },
    ]);
  });

  it("preserves a new reveal request for an existing browser while settings load", async () => {
    setup();
    settings.hydrated = false;
    await using screen = await render(<Harness sessions={[session]} />);
    const revealed = { ...session, revealRequest: { id: "reveal-2", force: true } };
    await screen.rerender(<Harness sessions={[revealed]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});

    settings.hydrated = true;
    await screen.rerender(<Harness sessions={[revealed]} />);
    expect(Object.values(usePreviewMiniPlayerStore.getState().byThreadKey)).toMatchObject([
      { source: { kind: "browser", tabId: session.tabId } },
    ]);
  });

  it.each([true, false])(
    "opens a device arriving during settings loading with auto-show set to %s",
    async (autoShow) => {
      setup();
      settings.hydrated = false;
      await using screen = await render(<Harness />);
      await screen.rerender(<Harness deviceState={openedDevice} />);
      expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
      expect(
        selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
      ).toEqual([]);

      settings.autoShow = autoShow;
      settings.hydrated = true;
      await screen.rerender(<Harness deviceState={openedDevice} />);
      if (autoShow) {
        expect(Object.values(usePreviewMiniPlayerStore.getState().byThreadKey)).toMatchObject([
          { source: { kind: "device", hostId: "local", deviceId: "phone" } },
        ]);
      } else {
        expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
        expect(
          selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef)
            .surfaces,
        ).toMatchObject([{ kind: "device", target: { hostId: "local", deviceId: "phone" } }]);
      }
    },
  );

  it("does not reopen a device already present before settings finish loading", async () => {
    setup();
    settings.hydrated = false;
    await using screen = await render(<Harness deviceState={openedDevice} />);
    settings.hydrated = true;
    await screen.rerender(<Harness deviceState={openedDevice} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, threadRef).surfaces,
    ).toEqual([]);
  });

  it("does not reopen existing sessions after settings finish loading", async () => {
    setup();
    settings.hydrated = false;
    await using screen = await render(<Harness sessions={[session]} />);
    settings.hydrated = true;
    await screen.rerender(<Harness sessions={[session]} />);
    expect(usePreviewMiniPlayerStore.getState().byThreadKey).toEqual({});
  });
});
