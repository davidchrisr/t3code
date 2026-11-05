const images = new WeakMap<SVGSVGElement, { key: string; image: string }>();
export const NATIVE_BROWSER_CURSOR_SELECTOR = "[data-agent-browser-cursor-tab]";

export function readNativeBrowserCursor(page: DOMRect, tabId: string, zoom: number) {
  const mark = [...document.querySelectorAll<HTMLElement>(NATIVE_BROWSER_CURSOR_SELECTOR)].find(
    (element) => element.dataset.agentBrowserCursorTab === tabId,
  );
  const svg = mark?.querySelector("svg");
  if (!mark || !svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const target = new DOMMatrix(mark.style.transform);
  const current = new DOMMatrix(getComputedStyle(mark).transform);
  const x = (rect.left + target.m41 - current.m41 - page.left) * zoom;
  const y = (rect.top + target.m42 - current.m42 - page.top) * zoom;
  const width = rect.width * zoom;
  const height = rect.height * zoom;
  if (x + width < 0 || y + height < 0 || x > page.width * zoom || y > page.height * zoom)
    return null;
  const style = getComputedStyle(svg);
  const halo = mark.querySelector("span");
  const key = JSON.stringify([style.fill, style.stroke, style.strokeWidth, halo !== null]);
  let cached = images.get(svg);
  if (cached?.key !== key) {
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute("class");
    copy.setAttribute("fill", style.fill);
    copy.setAttribute("stroke", style.stroke);
    copy.setAttribute("stroke-width", style.strokeWidth);
    if (halo) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const ratio = svg.viewBox.baseVal.width / rect.width;
      const markRect = mark.getBoundingClientRect();
      circle.setAttribute(
        "cx",
        String((halo.offsetLeft + halo.offsetWidth / 2 + markRect.left - rect.left) * ratio),
      );
      circle.setAttribute(
        "cy",
        String((halo.offsetTop + halo.offsetHeight / 2 + markRect.top - rect.top) * ratio),
      );
      circle.setAttribute("r", String((halo.offsetWidth / 2) * ratio));
      circle.setAttribute("fill", style.stroke);
      circle.setAttribute("fill-opacity", "0.25");
      circle.setAttribute("stroke", "none");
      copy.prepend(circle);
    }
    cached = {
      key,
      image: `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`,
    };
    images.set(svg, cached);
  }
  return { x, y, width, height, image: cached.image, opacity: Number(mark.style.opacity) };
}
