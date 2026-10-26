import { describe, expect, it, vi } from "vite-plus/test";

import { observeMobileSidebarSwipe } from "./mobileSidebarSwipe";

class TouchTarget extends EventTarget {
  app = true;
  sidebar = false;
  editable = false;
  button = false;
  click = vi.fn();

  closest(selector: string) {
    if (selector.startsWith("input")) return this.editable ? this : null;
    if (selector.startsWith("[data-sidebar")) return this.sidebar ? this : null;
    if (selector.startsWith("[data-slot")) return this.app ? this : null;
    return this.button ? this : null;
  }
}

function setup(open = false) {
  vi.stubGlobal("Element", TouchTarget);
  const document = Object.assign(new EventTarget(), {
    getSelection: () => ({ isCollapsed: true }),
  });
  const target = new TouchTarget();
  target.sidebar = open;
  const onOpenChange = vi.fn();
  const dispose = observeMobileSidebarSwipe(document as unknown as Document, {
    open,
    onOpenChange,
  });
  const touch = (type: string, x: number, y: number, count = 1) => {
    const points = Array.from({ length: count }, (_, identifier) => ({
      identifier,
      clientX: x,
      clientY: y,
    }));
    const list = Object.assign(points, { item: (index: number) => points[index] ?? null });
    const event = Object.assign(new Event(type, { cancelable: true }), {
      touches: list,
      changedTouches: list,
    });
    Object.defineProperty(event, "target", { value: target });
    document.dispatchEvent(event);
    return event;
  };
  return {
    target,
    touch,
    onOpenChange,
    [Symbol.dispose]() {
      dispose();
      vi.unstubAllGlobals();
    },
  };
}

describe("mobile sidebar swipe", () => {
  it("claims an edge touch before history navigation and opens after a rightward swipe", () => {
    using state = setup();
    expect(state.touch("touchstart", 10, 100).defaultPrevented).toBe(true);
    state.touch("touchmove", 70, 105);
    state.touch("touchend", 90, 110);
    expect(state.onOpenChange).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("leaves gestures outside the edge alone", () => {
    using state = setup();
    expect(state.touch("touchstart", 100, 100).defaultPrevented).toBe(false);
    state.touch("touchend", 200, 100);
    expect(state.onOpenChange).not.toHaveBeenCalled();
  });

  it("does not open after a vertical drag, even if it later turns horizontal", () => {
    using state = setup();
    state.touch("touchstart", 10, 100);
    state.touch("touchmove", 12, 140);
    state.touch("touchend", 100, 140);
    expect(state.onOpenChange).not.toHaveBeenCalled();
  });

  it("leaves multi-touch and input gestures alone", () => {
    using state = setup();
    expect(state.touch("touchstart", 10, 100, 2).defaultPrevented).toBe(false);
    state.touch("touchend", 100, 100);
    state.target.editable = true;
    expect(state.touch("touchstart", 10, 100).defaultPrevented).toBe(false);
    state.touch("touchend", 100, 100);
    expect(state.onOpenChange).not.toHaveBeenCalled();
  });

  it("closes an open sidebar on a leftward swipe", () => {
    using state = setup(true);
    state.touch("touchstart", 200, 100);
    expect(state.touch("touchmove", 180, 100).defaultPrevented).toBe(true);
    state.touch("touchend", 120, 100);
    expect(state.onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("preserves a button tap whose compatibility click was suppressed at the edge", () => {
    using state = setup();
    state.target.button = true;
    expect(state.touch("touchstart", 10, 100).defaultPrevented).toBe(true);
    state.touch("touchend", 10, 100);
    expect(state.target.click).toHaveBeenCalledOnce();
    expect(state.onOpenChange).not.toHaveBeenCalled();
  });
});
