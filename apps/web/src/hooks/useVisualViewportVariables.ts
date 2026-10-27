import { useEffect } from "react";

export function useVisualViewportVariables(enabled: boolean) {
  // oxlint-disable-next-line t3code/react-effect-budget -- Visual viewport events update CSS variables while the touch viewport is mounted.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const style = document.documentElement.style;
    const properties = [
      "--visual-viewport-height",
      "--visual-viewport-top",
      "--visual-viewport-bottom",
    ] as const;
    const previous = properties.map((property) => style.getPropertyValue(property));
    let frame: number | null = null;
    const update = () => {
      frame = null;
      style.setProperty(properties[0], `${viewport.height}px`);
      style.setProperty(properties[1], `${viewport.offsetTop}px`);
      style.setProperty(
        properties[2],
        `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`,
      );
    };
    const schedule = () => {
      frame ??= window.requestAnimationFrame(update);
    };
    update();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      for (const [index, property] of properties.entries()) {
        const value = previous[index];
        if (value) style.setProperty(property, value);
        else style.removeProperty(property);
      }
    };
  }, [enabled]);
}
