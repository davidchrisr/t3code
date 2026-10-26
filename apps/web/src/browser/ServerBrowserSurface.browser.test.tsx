import type {
  createPreviewStreamClient,
  createPreviewFramePainter,
} from "@t3tools/client-runtime/preview/server-browser-stream";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../test/render";
import { ServerBrowserSurface } from "./ServerBrowserSurface";
import "~/index.css";

const mocks = vi.hoisted(() => ({
  access: {
    httpBase: "http://localhost/api/preview-stream",
    wsBase: "ws://localhost/api/preview-stream",
    query: {},
    credentials: true,
  },
  connect: vi.fn<typeof createPreviewStreamClient>(),
  painter: vi.fn<typeof createPreviewFramePainter>(),
  send: vi.fn<ReturnType<typeof createPreviewStreamClient>["send"]>(),
  stop: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/preview/server-browser-stream"), async (original) => ({
  ...(await original()),
  createPreviewStreamClient: mocks.connect,
  createPreviewFramePainter: mocks.painter,
}));
vi.mock(import("~/state/previewStream"), () => ({
  usePreviewStreamAccess: () => mocks.access,
  refreshPreviewStreamAccess: vi.fn(),
}));

function setup() {
  mocks.connect.mockReset().mockReturnValue({ send: mocks.send, stop: mocks.stop });
  mocks.send.mockReset().mockReturnValue(true);
  mocks.stop.mockReset();
  mocks.painter.mockReset().mockImplementation((_canvas, onPainted) => ({
    paint: () => onPainted?.(),
    stop: () => undefined,
  }));
}

function Harness({ interactive }: { readonly interactive: boolean }) {
  return (
    <div data-testid="browser-container" style={{ width: 320, height: 240 }}>
      <ServerBrowserSurface
        environmentId={EnvironmentId.make("passive-browser")}
        threadId="thread"
        tabId="tab"
        visible
        followSize={false}
        interactive={interactive}
        className="size-full"
      />
    </div>
  );
}

describe("view-only server browser", () => {
  it("uses a passive stream and restores page input when opened interactively", async () => {
    setup();
    await using screen = await render(<Harness interactive={false} />);
    await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());
    expect(mocks.connect.mock.lastCall?.[0].interactive).toBe(false);
    const textarea = screen.container.querySelector("textarea")!;
    await userEvent.click(screen.getByTestId("browser-container"));
    textarea.focus();
    await userEvent.keyboard("hello");
    expect(document.activeElement).not.toBe(textarea);
    expect(mocks.send).not.toHaveBeenCalled();

    await screen.rerender(<Harness interactive />);
    await vi.waitFor(() => expect(mocks.connect.mock.lastCall?.[0].interactive).toBe(true));
    const events = mocks.connect.mock.lastCall![1];
    await act(() => {
      events.onViewport({ width: 320, height: 240 });
      events.onFrame(new ArrayBuffer(0));
      events.onControl?.({ canOperate: true, controller: "you", generation: 1, dialog: null });
    });
    textarea.focus();
    await userEvent.keyboard("a");
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ type: "key", key: "a" }));
  });
});
