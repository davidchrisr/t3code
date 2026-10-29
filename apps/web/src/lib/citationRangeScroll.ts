import { isSelectionRectVisible } from "./selectionActions";

function clippingBox(element: Element, view: Window) {
  const style = view.getComputedStyle(element);
  if (style.display === "contents") return null;
  const clipX = style.overflowX !== "visible";
  const clipY = style.overflowY !== "visible";
  if (!clipX && !clipY) return null;
  const bounds = element.getBoundingClientRect();
  const scaleX =
    "offsetWidth" in element && typeof element.offsetWidth === "number" && element.offsetWidth > 0
      ? bounds.width / element.offsetWidth
      : 1;
  const scaleY =
    "offsetHeight" in element &&
    typeof element.offsetHeight === "number" &&
    element.offsetHeight > 0
      ? bounds.height / element.offsetHeight
      : 1;
  const left = bounds.left + element.clientLeft * scaleX;
  const top = bounds.top + element.clientTop * scaleY;
  return {
    left: clipX ? left : -Infinity,
    right: clipX ? left + element.clientWidth * scaleX : Infinity,
    top: clipY ? top : -Infinity,
    bottom: clipY ? top + element.clientHeight * scaleY : Infinity,
    scaleX,
    scaleY,
    scrollX: clipX && style.overflowX !== "clip",
    scrollY: clipY && style.overflowY !== "clip",
  };
}

export function revealCitationRange(range: Range, boundary: HTMLElement, scroll = true) {
  const view = boundary.ownerDocument.defaultView;
  if (!view) return null;
  const rects = Array.from(range.getClientRects());
  const index = rects.findIndex((rect) => rect.width > 0 && rect.height > 0);
  if (index < 0) return null;
  const ancestors: Element[] = [];
  for (
    let element = range.startContainer.parentElement;
    element && element !== boundary;
    element = element.parentElement
  ) {
    const style = view.getComputedStyle(element);
    if (style.display === "none" || style.opacity === "0" || style.contentVisibility === "hidden")
      return null;
    if (element === range.startContainer.parentElement && style.visibility === "hidden")
      return null;
    ancestors.push(element);
    if (!scroll) continue;
    const box = clippingBox(element, view);
    const rect = range.getClientRects()[index];
    if (!box || !rect) continue;
    const dx =
      rect.left < box.left || rect.width > box.right - box.left
        ? rect.left - box.left
        : Math.max(0, rect.right - box.right);
    const dy =
      rect.top < box.top || rect.height > box.bottom - box.top
        ? rect.top - box.top
        : Math.max(0, rect.bottom - box.bottom);
    if ((box.scrollX && dx) || (box.scrollY && dy))
      element.scrollTo({
        left: element.scrollLeft + (box.scrollX ? dx / box.scaleX : 0),
        top: element.scrollTop + (box.scrollY ? dy / box.scaleY : 0),
        behavior: "instant",
      });
  }
  const clips = ancestors.flatMap((element) => {
    const box = clippingBox(element, view);
    return box ? [box] : [];
  });
  for (const rect of range.getClientRects()) {
    if (!isSelectionRectVisible(rect, clips)) continue;
    let { left, right, top, bottom } = rect;
    for (const box of clips) {
      left = Math.max(left, box.left);
      right = Math.min(right, box.right);
      top = Math.max(top, box.top);
      bottom = Math.min(bottom, box.bottom);
    }
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }
  return null;
}
