import { describe, expect, it } from "vite-plus/test";
import { revealCitationRange } from "./citationRangeScroll";

class ScrollBox {
  parentElement: ScrollBox | null = null;
  scrollLeft = 0;
  scrollTop = 0;
  clientLeft = 0;
  clientTop = 0;
  clientWidth = 120;
  clientHeight = 60;
  style = {
    display: "block",
    visibility: "visible",
    opacity: "1",
    contentVisibility: "visible",
    overflowX: "auto",
    overflowY: "auto",
  };
  ownerDocument = { defaultView: { getComputedStyle: (element: ScrollBox) => element.style } };
  get offsetWidth() {
    return this.clientWidth;
  }
  get offsetHeight() {
    return this.clientHeight;
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.clientWidth,
      bottom: this.clientHeight,
      width: this.clientWidth,
      height: this.clientHeight,
    };
  }
  scrollTo({ left, top }: { left: number; top: number }) {
    this.scrollLeft = left;
    this.scrollTop = top;
  }
}

function fixture(left = 400, top = 400, width = 80) {
  const boundary = new ScrollBox();
  boundary.clientHeight = 600;
  const scroller = new ScrollBox();
  scroller.parentElement = boundary;
  const range = {
    startContainer: { parentElement: scroller },
    getClientRects: () => {
      const x = left - scroller.scrollLeft,
        y = top - scroller.scrollTop;
      return [{ left: x, top: y, right: x + width, bottom: y + 20, width, height: 20 }];
    },
  };
  return {
    scroller,
    boundary: boundary as unknown as HTMLElement,
    range: range as unknown as Range,
  };
}

describe("citation ranges in scrolling content", () => {
  it("reveals the quoted fragment horizontally and vertically without moving the timeline", () => {
    const { range, boundary, scroller } = fixture();
    const rect = revealCitationRange(range, boundary);
    expect(rect).toMatchObject({ left: 40, top: 40, right: 120, bottom: 60 });
    expect(scroller.scrollLeft).toBe(360);
    expect(scroller.scrollTop).toBe(360);
    expect(boundary.scrollTop).toBe(0);
  });

  it("accepts a visible part of a quote wider than the scrolling viewport", () => {
    const { range, boundary, scroller } = fixture(400, 20, 400);
    expect(revealCitationRange(range, boundary)).toMatchObject({ left: 0, right: 120, width: 120 });
    expect(scroller.scrollLeft).toBe(400);
  });

  it("reports an unrevealable fragment behind overflow clipping", () => {
    const { range, boundary, scroller } = fixture(400, 20);
    scroller.style.overflowX = "clip";
    expect(revealCitationRange(range, boundary)).toBeNull();
    expect(scroller.scrollLeft).toBe(0);
  });

  it("checks clipping again without undoing later user scrolling", () => {
    const { range, boundary, scroller } = fixture(400, 20);
    expect(revealCitationRange(range, boundary)).not.toBeNull();
    scroller.scrollLeft = 0;
    expect(revealCitationRange(range, boundary, false)).toBeNull();
    expect(scroller.scrollLeft).toBe(0);
  });
});
