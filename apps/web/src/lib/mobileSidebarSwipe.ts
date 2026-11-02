const EDGE_WIDTH = 20;
const SWIPE_DISTANCE = 48;

export function observeMobileSidebarSwipe(
  document: Document,
  { open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void },
) {
  let gesture: {
    identifier: number;
    x: number;
    y: number;
    tapTarget: HTMLElement | null;
  } | null = null;
  const cancel = () => {
    gesture = null;
    document.removeEventListener("touchmove", move);
    document.removeEventListener("touchend", end);
    document.removeEventListener("touchcancel", cancel);
  };
  const start = (event: TouchEvent) => {
    cancel();
    const touch = event.touches.item(0);
    const target = event.target;
    if (
      !touch ||
      event.touches.length !== 1 ||
      event.defaultPrevented ||
      !(target instanceof Element) ||
      target.closest('input, textarea, select, [contenteditable="true"]') ||
      document.getSelection()?.isCollapsed === false
    )
      return;
    const sidebar = target.closest('[data-sidebar="sidebar"][data-mobile="true"]');
    if (open ? !sidebar : !target.closest('[data-slot="sidebar-wrapper"]')) return;
    if (!open && (touch.clientX > EDGE_WIDTH || !event.cancelable)) return;
    // Safari must see touchstart cancelled before it claims the history gesture.
    // Vertical scrolling starts outside this reserved edge.
    if (!open) event.preventDefault();
    gesture = {
      identifier: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      tapTarget: !open ? target.closest<HTMLElement>('button, a, [role="button"]') : null,
    };
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end, { passive: false });
    document.addEventListener("touchcancel", cancel);
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.defaultPrevented || event.touches.length !== 1) {
      cancel();
      return;
    }
    const touch = event.touches.item(0);
    if (!touch || touch.identifier !== gesture.identifier) return;
    const x = touch.clientX - gesture.x;
    const y = touch.clientY - gesture.y;
    if (Math.abs(y) > 8 && Math.abs(y) > Math.abs(x)) {
      cancel();
      return;
    }
    if (open && x < -8 && Math.abs(x) > Math.abs(y) * 1.5 && event.cancelable) {
      event.preventDefault();
    }
  };
  const end = (event: TouchEvent) => {
    const current = gesture;
    cancel();
    if (!current) return;
    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === current.identifier,
    );
    if (!touch) return;
    const x = touch.clientX - current.x;
    const y = touch.clientY - current.y;
    if (
      Math.abs(x) >= SWIPE_DISTANCE &&
      Math.abs(x) > Math.abs(y) * 1.5 &&
      (open ? x < 0 : x > 0)
    ) {
      if (event.cancelable) event.preventDefault();
      onOpenChange(!open);
    } else if (Math.abs(x) < 8 && Math.abs(y) < 8) {
      current.tapTarget?.click();
    }
  };
  document.addEventListener("touchstart", start, { capture: true, passive: false });
  return () => {
    document.removeEventListener("touchstart", start, true);
    cancel();
  };
}
