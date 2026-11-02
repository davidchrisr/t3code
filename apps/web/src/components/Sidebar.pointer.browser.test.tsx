import type { SensorProps } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vite-plus/test";
import { fakeTimers } from "../../test/render";
import {
  dismissContextMenu,
  isContextMenuOpen,
  showContextMenuFallback,
} from "../contextMenuFallback";
import { SidebarPointerSensor } from "./Sidebar.pointer";

const sensors: SidebarPointerSensor[] = [];

function pointer(type: string, values: PointerEventInit = {}) {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
    buttons: 1,
    ...values,
  });
}

function gesture(
  extraOptions: Partial<ConstructorParameters<typeof SidebarPointerSensor>[0]["options"]> = {},
  pointerType = "mouse",
) {
  const callbacks = {
    onStart: vi.fn(),
    onMove: vi.fn(),
    onEnd: vi.fn(),
    onCancel: vi.fn(),
    onAbort: vi.fn(),
    onPending: vi.fn(),
  };
  const onFinish = vi.fn();
  const props = {
    active: "thread",
    event: pointer("pointerdown", { pointerType }),
    options: { distance: 6, onAttach: vi.fn(), onFinish, ...extraOptions },
    ...callbacks,
  } as unknown as SensorProps<ConstructorParameters<typeof SidebarPointerSensor>[0]["options"]>;
  const sensor = new SidebarPointerSensor(props);
  sensors.push(sensor);
  return { sensor, onFinish, ...callbacks };
}

function setup() {
  const stack = new DisposableStack();
  stack.use(fakeTimers());
  stack.defer(() => {
    for (const sensor of sensors.splice(0)) sensor.cancel();
    dismissContextMenu(false);
    // Cancelled sensors keep suppressing clicks on the shared document until the next press.
    document.dispatchEvent(pointer("pointerdown"));
    vi.runAllTimers();
  });
  return stack;
}

describe("sidebar pointer lifecycle", () => {
  it("opens the menu during a touch hold and keeps it open after release without clicking", () => {
    using _environment = setup();
    const onTouchHold = vi.fn(() => {
      void showContextMenuFallback([{ id: "rename", label: "Rename" }]);
    });
    const onTouchHoldCancel = vi.fn();
    const drag = gesture({ onTouchHold, onTouchHoldCancel }, "touch");

    vi.advanceTimersByTime(500);
    expect(onTouchHold).toHaveBeenCalledExactlyOnceWith("thread", { x: 10, y: 10 });
    expect(drag.onStart).not.toHaveBeenCalled();
    expect(isContextMenuOpen()).toBe(true);
    vi.runOnlyPendingTimers();
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    expect(isContextMenuOpen()).toBe(true);

    document.dispatchEvent(pointer("pointerup", { pointerType: "touch", buttons: 0 }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(onTouchHoldCancel).not.toHaveBeenCalled();
    expect(drag.onStart).not.toHaveBeenCalled();
    expect(drag.onAbort).toHaveBeenCalledOnce();
    expect(isContextMenuOpen()).toBe(true);
  });

  it("dismisses the held menu before starting a touch drag", () => {
    using _environment = setup();
    const onTouchHold = vi.fn();
    const onTouchHoldCancel = vi.fn();
    const drag = gesture({ onTouchHold, onTouchHoldCancel }, "touch");
    vi.advanceTimersByTime(500);

    document.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientY: 30 }));
    const touchMove = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
    document.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(true);
    expect(onTouchHoldCancel).toHaveBeenCalledOnce();
    expect(onTouchHoldCancel.mock.invocationCallOrder[0]).toBeLessThan(
      drag.onStart.mock.invocationCallOrder[0]!,
    );
    expect(drag.onStart).toHaveBeenCalledOnce();
    expect(drag.onMove).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 30 });

    document.dispatchEvent(pointer("pointerup", { pointerType: "touch", clientY: 30, buttons: 0 }));
    expect(drag.onEnd).toHaveBeenCalledOnce();
    expect(onTouchHoldCancel).toHaveBeenCalledOnce();
  });

  it("leaves touch taps and swipes before the hold to navigation and scrolling", () => {
    using _environment = setup();
    for (const swipe of [false, true]) {
      const onTouchHold = vi.fn();
      const drag = gesture({ onTouchHold }, "touch");
      if (swipe) {
        document.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientY: 30 }));
      }
      document.dispatchEvent(pointer("pointerup", { pointerType: "touch", buttons: 0 }));
      vi.advanceTimersByTime(500);
      const click = new MouseEvent("click", { bubbles: true, cancelable: true });
      document.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(swipe);
      const touchMove = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
      document.dispatchEvent(touchMove);
      expect(touchMove.defaultPrevented).toBe(false);
      expect(onTouchHold).not.toHaveBeenCalled();
      expect(drag.onStart).not.toHaveBeenCalled();
    }
  });

  it("cancels a held menu on pointer cancellation and releases the touch listeners", () => {
    using _environment = setup();
    const onTouchHoldCancel = vi.fn();
    const drag = gesture({ onTouchHold: vi.fn(), onTouchHoldCancel }, "touch");
    vi.advanceTimersByTime(500);
    document.dispatchEvent(pointer("pointercancel", { pointerType: "touch" }));
    expect(onTouchHoldCancel).toHaveBeenCalledOnce();
    expect(drag.onCancel).toHaveBeenCalledOnce();
    const touchMove = new TouchEvent("touchmove", { bubbles: true, cancelable: true });
    document.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(false);
  });

  it("keeps mouse dragging immediate when touch hold handlers are configured", () => {
    using _environment = setup();
    const onTouchHold = vi.fn();
    const drag = gesture({ onTouchHold });
    document.dispatchEvent(pointer("pointermove", { clientY: 30 }));
    expect(drag.onStart).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    expect(onTouchHold).not.toHaveBeenCalled();
  });

  it("suppresses duplicate native touch menus and cancels before dragging an unavailable row", () => {
    using _environment = setup();
    const onTouchHold = vi.fn();
    const onTouchHoldCancel = vi.fn();
    const drag = gesture({ onTouchHold, onTouchHoldCancel, touchDragDisabled: true }, "touch");
    const contextMenu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    document.dispatchEvent(contextMenu);
    expect(contextMenu.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(500);
    expect(onTouchHold).toHaveBeenCalledOnce();
    document.dispatchEvent(pointer("pointermove", { pointerType: "touch", clientY: 30 }));
    expect(onTouchHoldCancel).toHaveBeenCalledOnce();
    expect(drag.onStart).not.toHaveBeenCalled();
  });

  it.each(["mouse", "touch"])(
    "drops %s context when a zero-button move precedes pointerup",
    (pointerType) => {
      using _environment = setup();
      const onDrop = vi.fn((point: { x: number; y: number }) => point.x > 50);
      const drag = gesture({ onMove: (point) => point.x > 50, onDrop }, pointerType);
      document.dispatchEvent(pointer("pointermove", { clientY: 20 }));
      document.dispatchEvent(pointer("pointermove", { clientX: 90, clientY: 30 }));

      // Native desktop releases can report the released button on the final move.
      document.dispatchEvent(pointer("pointermove", { buttons: 0, clientX: 94, clientY: 32 }));
      document.dispatchEvent(pointer("pointerup", { buttons: 0, clientX: 94, clientY: 32 }));
      document.dispatchEvent(pointer("pointermove", { buttons: 0, clientX: 100, clientY: 40 }));

      expect(onDrop).toHaveBeenCalledExactlyOnceWith({ x: 94, y: 32 });
      expect(drag.onCancel).toHaveBeenCalledOnce();
      expect(drag.onEnd).not.toHaveBeenCalled();
      expect(drag.onFinish).toHaveBeenCalledExactlyOnceWith(true);
    },
  );

  // regression: #17373 a zero-button release outside a drop target must cancel, not reorder
  it("cancels a missed sidebar release without committing a reorder", () => {
    using _environment = setup();
    const onDrop = vi.fn((point: { x: number; y: number }) => point.x > 50);
    const drag = gesture({ onMove: (point) => point.x > 50, onDrop });
    document.dispatchEvent(pointer("pointermove", { clientX: 90, clientY: 30 }));
    document.dispatchEvent(pointer("pointermove", { buttons: 0, clientX: 30, clientY: 40 }));
    document.dispatchEvent(pointer("pointerup", { buttons: 0, clientX: 30, clientY: 40 }));

    expect(onDrop).toHaveBeenCalledExactlyOnceWith({ x: 30, y: 40 });
    expect(drag.onCancel).toHaveBeenCalledOnce();
    expect(drag.onEnd).not.toHaveBeenCalled();
    expect(drag.onFinish).toHaveBeenCalledExactlyOnceWith(true);
  });
});
