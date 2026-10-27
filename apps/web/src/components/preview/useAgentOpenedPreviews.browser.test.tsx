import {
  EnvironmentId,
  ThreadId,
  type ClientSettings,
  type DeviceServiceState,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
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

function Harness({ deviceState = devices }: { readonly deviceState?: DeviceServiceState }) {
  useAgentOpenedPreviews({
    threadRef,
    deviceState,
    deviceStateLoaded: true,
    miniPlayerSource: null,
    sheetLayout: false,
  });
  return null;
}

describe("agent-opened floating previews", () => {
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
});
