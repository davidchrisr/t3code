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

async function renderSurface() {
  setup();
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(<Harness interactive />));
  const canvas = screen.container.querySelector("canvas");
  if (!canvas) throw new Error("The surface did not render its canvas.");
  await vi.waitFor(() => expect(mocks.connect).toHaveBeenCalled());
  return Object.assign(stack.move(), { canvas });
}

const mouseUp = (canvas: HTMLCanvasElement, button: number) => {
  const event = new MouseEvent("mouseup", { button, bubbles: true, cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};

describe("ServerBrowserSurface", () => {
  it("routes mouse thumb buttons to the preview's history instead of the app", async () => {
    await using surface = await renderSurface();
    const { canvas } = surface;

    expect(mouseUp(canvas, 3).defaultPrevented).toBe(true);
    expect(mouseUp(canvas, 4).defaultPrevented).toBe(true);
    expect(mocks.send.mock.calls).toEqual([
      [{ type: "history", delta: -1 }],
      [{ type: "history", delta: 1 }],
    ]);
  });

  it("leaves other mouse buttons alone", async () => {
    await using surface = await renderSurface();
    const { canvas } = surface;

    expect(mouseUp(canvas, 0).defaultPrevented).toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not forward thumb-button presses to the page", async () => {
    await using surface = await renderSurface();
    const { canvas } = surface;
    canvas.width = 400;
    canvas.height = 300;
    // Synthetic pointers have no active pointer id to capture.
    canvas.setPointerCapture = () => undefined;
    mocks.painter.mock.lastCall?.[1]?.();
    mocks.connect.mock.lastCall?.[1].onViewport({ width: 400, height: 300 });
    mocks.connect.mock.lastCall?.[1].onControl?.({
      canOperate: true,
      controller: "you",
      generation: 1,
      dialog: null,
    });
    const { left, top } = canvas.getBoundingClientRect();
    const press = (type: "pointerdown" | "pointerup", button: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          button,
          buttons: type === "pointerdown" ? 1 << button : 0,
          clientX: left + 10,
          clientY: top + 10,
          pointerType: "mouse",
          bubbles: true,
        }),
      );
    const mouseInputs = () => mocks.send.mock.calls.filter(([input]) => input.type === "mouse");

    for (const button of [3, 4]) {
      press("pointerdown", button);
      press("pointerup", button);
    }
    expect(mouseInputs()).toEqual([]);

    press("pointerdown", 0);
    expect(mouseInputs()).not.toEqual([]);
  });
});
