import { observeResize } from "~/lib/observeResize";
import { NATIVE_BROWSER_CURSOR_SELECTOR } from "./nativeBrowserCursor";

const OVERLAY_SELECTOR =
  '[data-slot$="-popup"], [data-slot$="-backdrop"], [role="dialog"], [role="alertdialog"]';

export function observeNativeBrowserOcclusion(
  element: HTMLElement,
  onChange: () => void,
  tabId: string,
): () => void {
  let frame: number | undefined;
  const update = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      onChange();
    });
  };
  const hasCursor = (node: Element) =>
    node.closest<HTMLElement>(NATIVE_BROWSER_CURSOR_SELECTOR)?.dataset.agentBrowserCursorTab ===
      tabId ||
    [...node.querySelectorAll<HTMLElement>(NATIVE_BROWSER_CURSOR_SELECTOR)].some(
      (cursor) => cursor.dataset.agentBrowserCursorTab === tabId,
    );
  const containsObserved = (node: Node) =>
    node instanceof Element &&
    (node.matches(OVERLAY_SELECTOR) ||
      node.closest(OVERLAY_SELECTOR) !== null ||
      node.querySelector(OVERLAY_SELECTOR) !== null ||
      hasCursor(node));
  const mutations = new MutationObserver((records) => {
    if (
      records.some((record) =>
        record.type === "attributes"
          ? containsObserved(record.target)
          : (record.target instanceof Element &&
              record.target.closest<HTMLElement>(NATIVE_BROWSER_CURSOR_SELECTOR)?.dataset
                .agentBrowserCursorTab === tabId) ||
            [...record.addedNodes, ...record.removedNodes].some(containsObserved),
      )
    )
      update();
  });
  mutations.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "data-open",
      "data-closed",
      "data-state",
      "data-agent-browser-cursor-tab",
    ],
  });
  const stopResize = observeResize(element, onChange);
  document.addEventListener("visibilitychange", update);
  document.addEventListener("scroll", update, true);
  window.addEventListener("resize", update);
  update();
  return () => {
    mutations.disconnect();
    stopResize();
    if (frame !== undefined) cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", update);
    document.removeEventListener("scroll", update, true);
    window.removeEventListener("resize", update);
  };
}

export function nativeBrowserIsOccluded(rect: DOMRect): boolean {
  return [...document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)].some((overlay) => {
    const style = getComputedStyle(overlay);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const bounds = overlay.getBoundingClientRect();
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.left < rect.right &&
      bounds.right > rect.left &&
      bounds.top < rect.bottom &&
      bounds.bottom > rect.top
    );
  });
}
