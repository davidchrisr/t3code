import { type PointerEvent as ReactPointerEvent } from "react";
import { TouchSensor, type SensorProps } from "@dnd-kit/core";
import { getOwnerDocument, getWindow } from "@dnd-kit/utilities";

type Options = {
  distance: number;
  onAttach: (sensor: SidebarPointerSensor) => void;
  onFinish: (started: boolean) => void;
  onTouchHold?: (activeKey: string, point: { x: number; y: number }) => void;
  onTouchHoldCancel?: () => void;
  touchDragDisabled?: boolean;
  /** Return true to claim the move and hide this position from sorting. */
  onMove?: (point: { x: number; y: number }) => boolean;
  /** Return true to consume the release and cancel sorting. */
  onDrop?: (point: { x: number; y: number }) => boolean;
};

export class SidebarPointerSensor {
  // Safari requires a non-passive listener before the touch gesture starts.
  static setup = TouchSensor.setup;
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent) =>
        nativeEvent.isPrimary && nativeEvent.button === 0,
    },
  ];
  autoScrollEnabled = true;
  private phase: "pending" | "dragging" | "finished" = "pending";
  private readonly pointer: PointerEvent;
  private readonly document: Document;
  private readonly window: Window;
  private holdTimer: number | undefined;
  private touchHeld = false;
  private touchMenuOpen = false;

  constructor(private readonly props: Omit<SensorProps<Options>, "activeNode" | "context">) {
    this.pointer = props.event as PointerEvent;
    this.document = getOwnerDocument(this.pointer.target);
    this.window = getWindow(this.pointer.target);
    this.document.addEventListener("pointermove", this.move, { passive: false, capture: true });
    this.document.addEventListener("pointerup", this.end, { capture: true });
    this.document.addEventListener("pointercancel", this.pointerCancel, { capture: true });
    this.document.addEventListener("keydown", this.keydown, { capture: true });
    this.document.addEventListener("visibilitychange", this.visibilityChange);
    this.window.addEventListener("blur", this.cancel);
    this.window.addEventListener("pagehide", this.cancel);
    this.window.addEventListener("resize", this.cancel);
    this.document.addEventListener("dragstart", this.preventDefault);
    this.document.addEventListener("contextmenu", this.contextMenu, { capture: true });
    if (this.isTouchHold()) {
      this.document.addEventListener("touchmove", this.touchMove, {
        passive: false,
        capture: true,
      });
      this.document.addEventListener("touchstart", this.touchStart, { capture: true });
      this.holdTimer = this.window.setTimeout(() => {
        this.touchHeld = true;
        this.touchMenuOpen = true;
        this.document.addEventListener("click", this.suppressClick, { capture: true });
        this.document.addEventListener("pointerdown", this.clearClickSuppression, {
          capture: true,
        });
        props.options.onTouchHold?.(String(props.active), this.coordinates());
      }, 500);
    }
    props.options.onAttach(this);
    props.onPending(props.active, { distance: props.options.distance }, this.coordinates());
  }

  private coordinates = () => ({ x: this.pointer.clientX, y: this.pointer.clientY });
  private isTouchHold = () =>
    this.pointer.pointerType === "touch" && this.props.options.onTouchHold !== undefined;
  private preventDefault = (event: Event) => event.preventDefault();
  private contextMenu = (event: Event) => {
    event.preventDefault();
    if (this.isTouchHold()) event.stopImmediatePropagation();
  };
  private touchStart = (event: TouchEvent) => {
    if (event.touches.length > 1) this.cancel();
  };
  private touchMove = (event: TouchEvent) => {
    if (this.touchHeld && event.cancelable) event.preventDefault();
  };
  private closeTouchMenu = () => {
    if (!this.touchMenuOpen) return;
    this.touchMenuOpen = false;
    this.props.options.onTouchHoldCancel?.();
  };
  private clearClickSuppression = () => {
    this.document.removeEventListener("click", this.suppressClick, { capture: true });
    this.document.removeEventListener("pointerdown", this.clearClickSuppression, { capture: true });
  };
  private suppressClick = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    this.clearClickSuppression();
  };
  private clearSelection = () => this.document.getSelection()?.removeAllRanges();

  private move = (event: PointerEvent) => {
    if (this.phase === "finished" || event.pointerId !== this.pointer.pointerId) return;
    const coordinates = { x: event.clientX, y: event.clientY };
    // Desktop may report buttons=0 before pointerup; drop active context drags before cancelling sort.
    if ((event.buttons & 1) === 0) {
      if (this.phase === "dragging") this.props.options.onDrop?.(coordinates);
      return this.cancel();
    }
    if (this.phase === "pending") {
      const offset = {
        x: event.clientX - this.pointer.clientX,
        y: event.clientY - this.pointer.clientY,
      };
      if (Math.hypot(offset.x, offset.y) <= this.props.options.distance) {
        this.props.onPending(
          this.props.active,
          { distance: this.props.options.distance },
          this.coordinates(),
          offset,
        );
        return;
      }
      if (this.isTouchHold()) {
        if (!this.touchHeld || this.props.options.touchDragDisabled) return this.cancel();
        this.closeTouchMenu();
      }
      this.phase = "dragging";
      this.document.addEventListener("click", this.suppressClick, { capture: true });
      this.document.addEventListener("selectionchange", this.clearSelection);
      this.clearSelection();
      this.props.onStart(this.coordinates());
    }
    if (this.phase === "dragging") {
      if (event.cancelable) event.preventDefault();
      if (this.props.options.onMove?.(coordinates) === true) return;
      this.props.onMove(coordinates);
    }
  };

  private end = (event: PointerEvent) => {
    if (event.pointerId !== this.pointer.pointerId) return;
    const dropped =
      this.phase === "dragging" &&
      this.props.options.onDrop?.({ x: event.clientX, y: event.clientY }) === true;
    this.finish(dropped);
  };
  private pointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.pointer.pointerId) this.cancel();
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.code === "Escape") this.cancel();
  };
  private visibilityChange = () => {
    if (this.document.hidden) this.cancel();
  };
  cancel = () => this.finish(true);

  private finish(cancelled: boolean) {
    if (this.phase === "finished") return;
    const aborted = this.phase === "pending";
    this.phase = "finished";
    this.window.clearTimeout(this.holdTimer);
    if (cancelled) this.closeTouchMenu();
    this.document.removeEventListener("pointermove", this.move, { capture: true });
    this.document.removeEventListener("pointerup", this.end, { capture: true });
    this.document.removeEventListener("pointercancel", this.pointerCancel, { capture: true });
    this.document.removeEventListener("keydown", this.keydown, { capture: true });
    this.document.removeEventListener("visibilitychange", this.visibilityChange);
    this.window.removeEventListener("blur", this.cancel);
    this.window.removeEventListener("pagehide", this.cancel);
    this.window.removeEventListener("resize", this.cancel);
    this.document.removeEventListener("dragstart", this.preventDefault);
    this.document.removeEventListener("contextmenu", this.contextMenu, { capture: true });
    this.document.removeEventListener("touchmove", this.touchMove, { capture: true });
    this.document.removeEventListener("touchstart", this.touchStart, { capture: true });
    this.document.removeEventListener("selectionchange", this.clearSelection);
    // Suppress the eventual click after cancellation; a fresh pointerdown clears suppression after
    // out-of-document release.
    if (!aborted || cancelled) {
      this.document.addEventListener("click", this.suppressClick, { capture: true });
      this.document.addEventListener("pointerdown", this.clearClickSuppression, { capture: true });
    }
    try {
      // Release the preview before dnd-kit clears transforms; end/cancel events may be omitted before first
      // layout.
      this.props.options.onFinish(!aborted);
    } finally {
      if (aborted) this.props.onAbort(this.props.active);
      if (cancelled) this.props.onCancel();
      else this.props.onEnd();
    }
  }
}
