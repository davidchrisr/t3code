import { describe, expect, it, vi } from "vite-plus/test";

import { observeSelectionActions } from "./selectionActions";

function setup(touchSelection: boolean) {
  vi.useFakeTimers();
  const view = Object.assign(new EventTarget(), {
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  });
  const document = Object.assign(new EventTarget(), { defaultView: view, activeElement: null });
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document,
    closest: () => null,
    contains: (target: unknown) => target === element,
  });
  const onSelection = vi.fn();
  const onDismiss = vi.fn();
  const actions = observeSelectionActions({
    element: element as unknown as HTMLElement,
    touchSelection,
    onSelection,
    onDismiss,
  });
  const pointer = (type: string, pointerType: "touch" | "mouse") => {
    const event = Object.assign(new Event(type), {
      isPrimary: true,
      button: 0,
      pointerType,
    });
    if (type === "pointerdown") {
      Object.defineProperty(event, "target", { value: element });
      document.dispatchEvent(event);
      element.dispatchEvent(event);
    } else {
      view.dispatchEvent(event);
    }
  };
  return {
    actions,
    element,
    pointer,
    onSelection,
    onDismiss,
    [Symbol.dispose]() {
      actions.dispose();
      vi.useRealTimers();
    },
  };
}

describe("touch selection actions", () => {
  it("offers actions after a native touch menu cancels the pointer without a mouseup", async () => {
    using state = setup(true);
    state.pointer("pointerdown", "touch");
    const contextMenu = new Event("contextmenu", { cancelable: true });
    state.element.dispatchEvent(contextMenu);
    state.pointer("pointercancel", "touch");
    state.actions.selectionChanged();
    await vi.runAllTimersAsync();

    expect(contextMenu.defaultPrevented).toBe(false);
    expect(state.onSelection).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("updates native handle selections without waiting for a compatibility mouse event", async () => {
    using state = setup(true);
    state.pointer("pointerdown", "touch");
    state.actions.selectionChanged();
    await vi.runAllTimersAsync();
    expect(state.onSelection).toHaveBeenCalledExactlyOnceWith(null);

    state.onSelection.mockClear();
    state.actions.selectionChanged();
    await vi.runAllTimersAsync();
    expect(state.onSelection).toHaveBeenCalledExactlyOnceWith(null);
  });

  it("keeps right-click dismissal for mouse selection", async () => {
    using state = setup(true);
    state.pointer("pointerdown", "mouse");
    state.element.dispatchEvent(new Event("contextmenu"));
    state.actions.selectionChanged();
    await vi.runAllTimersAsync();

    expect(state.onSelection).not.toHaveBeenCalled();
    expect(state.onDismiss).toHaveBeenLastCalledWith("interaction");
  });

  it("preserves the existing dismissal behavior for callers without touch selection", async () => {
    using state = setup(false);
    state.pointer("pointerdown", "touch");
    state.element.dispatchEvent(new Event("contextmenu"));
    state.pointer("pointercancel", "touch");
    state.actions.selectionChanged();
    await vi.runAllTimersAsync();

    expect(state.onSelection).not.toHaveBeenCalled();
  });
});
