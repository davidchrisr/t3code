// @effect-diagnostics nodeBuiltinImport:off - Runs the injected script against a small DOM fixture without a browser.
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { HTML_RENDER_CITATION_SCRIPT, readHtmlRenderCitation } from "./htmlRenderCitations.ts";

class TextNode {
  readonly data: string;
  readonly nodeType = 3;
  parentElement: ElementNode | null = null;
  rect = { left: 0, top: 20, width: 100, height: 20 };
  constructor(data: string) {
    this.data = data;
  }
  get length() {
    return this.data.length;
  }
}

class ElementNode {
  readonly localName: string;
  readonly attributes: Record<string, string>;
  readonly nodeType = 1;
  namespaceURI = "http://www.w3.org/1999/xhtml";
  parentElement: ElementNode | null = null;
  childNodes: Array<ElementNode | TextNode> = [];
  display = "block";
  visibility: "visible" | "hidden" | "collapse" | undefined;
  get computedVisibility(): string {
    return this.visibility ?? this.parentElement?.computedVisibility ?? "visible";
  }
  overflowX = "visible";
  overflowY = "visible";
  scrollLeft = 0;
  scrollTop = 0;
  clientLeft = 0;
  clientTop = 0;
  isConnected = true;
  get clientWidth() {
    return this.rect.width;
  }
  get clientHeight() {
    return this.rect.height;
  }
  rect = { left: 0, top: 20, width: 100, height: 20 };
  style: Record<string, string> = {};
  textContent = "";
  listeners = new Map<string, (event: { isTrusted: boolean }) => void>();
  constructor(localName: string, attributes: Record<string, string> = {}) {
    this.localName = localName;
    this.attributes = attributes;
  }
  get id() {
    return this.attributes.id ?? "";
  }
  get outerHTML(): string {
    return `<${this.localName}${Object.entries(this.attributes)
      .map(([key, value]) => ` ${key}="${value}"`)
      .join(
        "",
      )}>${this.childNodes.map((node) => (node instanceof TextNode ? node.data : node.outerHTML)).join("")}</${this.localName}>`;
  }
  append(...children: Array<ElementNode | TextNode>) {
    for (const child of children) {
      child.parentElement = this;
      this.childNodes.push(child);
    }
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
  getAttribute(key: string) {
    return this.attributes[key] ?? null;
  }
  matches(selector: string): boolean {
    return selector
      .split(",")
      .some(
        (part) =>
          part.trim() === this.localName ||
          (part.trim() === "[data-t3-citation-ui]" && "data-t3-citation-ui" in this.attributes),
      );
  }
  closest(selector: string): ElementNode | null {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  checkVisibility(): boolean {
    if (this.display === "contents") return false;
    for (let ancestor = this.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.display === "none") return false;
    }
    return this.display !== "none" && this.computedVisibility === "visible";
  }
  getClientRects() {
    return this.checkVisibility() ? [this.rect] : [];
  }
  getBoundingClientRect() {
    return this.checkVisibility()
      ? positionedRect(this)
      : { ...positionedRect(this), width: 0, height: 0 };
  }
  scrollIntoView() {}
  scrollTo({ left, top }: { left: number; top: number }) {
    this.scrollLeft = left;
    this.scrollTop = top;
  }
  cloneNode() {
    return new ElementNode(this.localName, { ...this.attributes });
  }
  querySelectorAll() {
    return [];
  }
  addEventListener(type: string, listener: (event: { isTrusted: boolean }) => void) {
    this.listeners.set(type, listener);
  }
  remove() {}
}

class SvgViewport extends ElementNode {
  override get clientWidth() {
    return 0;
  }
  override get clientHeight() {
    return 0;
  }
  width = { animVal: { value: 200 } };
  height = { animVal: { value: 100 } };
  viewBox = { animVal: { x: 10, y: 20, width: 100, height: 100 } };
  preserveAspectRatio = { animVal: { align: 6, meetOrSlice: 1 } };
  matrix = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 40 };
  constructor(...children: Array<ElementNode | TextNode>) {
    super("svg");
    this.namespaceURI = "http://www.w3.org/2000/svg";
    this.overflowX = "hidden";
    this.overflowY = "hidden";
    this.append(...children);
  }
  getScreenCTM() {
    return this.matrix;
  }
}

class CssSvgViewport extends SvgViewport {
  override get clientWidth() {
    return 300;
  }
  override get clientHeight() {
    return 100;
  }
}

function positionedRect(node: ElementNode | TextNode) {
  let { left, top, width, height } = node.rect;
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    left -= parent.scrollLeft;
    top -= parent.scrollTop;
  }
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function scriptFixture(children: Array<ElementNode | TextNode>) {
  const body = new ElementNode("body");
  const html = element("html", body);
  body.append(...children);
  const textNodes: TextNode[] = [];
  const elements: ElementNode[] = [];
  const visit = (node: ElementNode | TextNode) => {
    if (node instanceof TextNode) textNodes.push(node);
    else {
      elements.push(node);
      node.childNodes.forEach(visit);
    }
  };
  visit(body);
  const first = textNodes[0];
  const last = textNodes.at(-1);
  const range = {
    startContainer: first,
    startOffset: 0,
    endContainer: last,
    endOffset: last?.length ?? 0,
    intersectsNode: (node: TextNode) => textNodes.includes(node),
    getBoundingClientRect() {
      return this.startContainer
        ? positionedRect(this.startContainer)
        : { left: 0, top: 20, width: 100, height: 20, right: 100, bottom: 40 };
    },
    getClientRects() {
      return this.startContainer ? [positionedRect(this.startContainer)] : [];
    },
    selectNodeContents(node: TextNode) {
      this.startContainer = node;
      this.endContainer = node;
      this.startOffset = 0;
      this.endOffset = node.length;
    },
    setStart(node: TextNode, offset: number) {
      this.startContainer = node;
      this.startOffset = offset;
    },
    setEnd(node: TextNode, offset: number) {
      this.endContainer = node;
      this.endOffset = offset;
    },
  };
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, (event: unknown) => void>();
  const postMessage = vi.fn();
  const parent = { postMessage };
  const observers: Array<{ callback: () => void; targets: Set<ElementNode> }> = [];
  const timers = new Map<number, () => void>();
  NodeVM.runInNewContext(HTML_RENDER_CITATION_SCRIPT, {
    window: {
      parent,
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        windowListeners.set(type, listener),
      getSelection: () => ({
        isCollapsed: false,
        rangeCount: 1,
        getRangeAt: () => range,
        removeAllRanges: () => {},
      }),
    },
    document: {
      body,
      documentElement: html,
      head: new ElementNode("head"),
      addEventListener: (type: string, listener: () => void) =>
        documentListeners.set(type, listener),
      createTreeWalker: () => {
        let at = 0;
        return { nextNode: () => textNodes[at++] ?? null };
      },
      createElement: (tag: string) => new ElementNode(tag),
      createRange: () => ({ ...range }),
      querySelectorAll: (selector: string) =>
        elements.filter((element) => `#${element.id}` === selector),
    },
    NodeFilter: { SHOW_TEXT: 4 },
    Element: ElementNode,
    SVGSVGElement: SvgViewport,
    ResizeObserver: class {
      readonly entry: (typeof observers)[number];
      constructor(callback: () => void) {
        this.entry = { callback, targets: new Set() };
        observers.push(this.entry);
      }
      observe(target: ElementNode) {
        this.entry.targets.add(target);
      }
      disconnect() {
        this.entry.targets.clear();
      }
    },
    getComputedStyle: (element: ElementNode) => ({
      display: element.display,
      visibility: element.computedVisibility,
      opacity: element.style.opacity ?? "1",
      overflowX: element.overflowX,
      overflowY: element.overflowY,
      borderLeftWidth: element.style.borderLeftWidth ?? "0px",
      borderRightWidth: element.style.borderRightWidth ?? "0px",
      borderTopWidth: element.style.borderTopWidth ?? "0px",
      borderBottomWidth: element.style.borderBottomWidth ?? "0px",
      paddingLeft: element.style.paddingLeft ?? "0px",
      paddingRight: element.style.paddingRight ?? "0px",
      paddingTop: element.style.paddingTop ?? "0px",
      paddingBottom: element.style.paddingBottom ?? "0px",
    }),
    CSS: { highlights: new Map(), escape: (value: string) => value },
    innerWidth: 800,
    innerHeight: 600,
    setTimeout: (callback: () => void) => {
      const id = timers.size + 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const control = (params: Record<string, unknown>) =>
    windowListeners.get("message")?.({
      source: parent,
      data: { jsonrpc: "2.0", method: "t3/citation", params },
    });
  return {
    body,
    html,
    postMessage,
    control,
    scroll: () => windowListeners.get("scroll")?.({}),
    resize: () => windowListeners.get("resize")?.({}),
    resizeTarget: (target: ElementNode) => {
      for (const observer of observers) {
        if (observer.targets.has(target)) observer.callback();
      }
    },
    expire: () => {
      for (const callback of timers.values()) callback();
    },
    outline: () => {
      const box = body.childNodes.find(
        (node) =>
          node instanceof ElementNode &&
          node.localName === "div" &&
          "data-t3-citation-ui" in node.attributes,
      );
      if (!(box instanceof ElementNode)) throw new Error("Expected citation outline");
      return box.style;
    },
    capture: () => {
      control({ action: "enable" });
      documentListeners.get("selectionchange")?.();
      const button = body.childNodes.find(
        (node) => node instanceof ElementNode && node.localName === "button",
      );
      if (!(button instanceof ElementNode)) return undefined;
      button.listeners.get("click")?.({ isTrusted: true });
      return readHtmlRenderCitation(postMessage.mock.calls.at(-1)?.[0]);
    },
  };
}

function element(tag: string, ...children: Array<ElementNode | TextNode>) {
  const node = new ElementNode(tag);
  if (tag === "svg" || tag === "foreignObject") node.namespaceURI = "http://www.w3.org/2000/svg";
  node.append(...children);
  return node;
}

describe("injected visualization citation behavior", () => {
  it.each(["hidden", "collapse"] as const)(
    "omits %s text from a spanning citation",
    (visibility) => {
      const secret = element("span", new TextNode(" secret"));
      secret.display = "inline";
      secret.visibility = visibility;
      const fixture = scriptFixture([
        element("p", new TextNode("Revenue"), secret, new TextNode(" is $42")),
      ]);
      const citation = fixture.capture();
      expect(citation).toMatchObject({
        text: "Revenue is $42",
        start: 0,
        end: 14,
        prefix: "",
        suffix: "",
      });
      fixture.postMessage.mockClear();
      fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
    },
  );

  it.each(["hidden", "collapse"] as const)(
    "keeps a visible descendant of a %s ancestor",
    (visibility) => {
      const visible = element("strong", new TextNode("Revenue is $42"));
      visible.visibility = "visible";
      const wrapper = element("p", new TextNode("secret "), visible);
      wrapper.visibility = visibility;
      const fixture = scriptFixture([wrapper]);
      const citation = fixture.capture();
      expect(citation?.text).toBe("Revenue is $42");
      fixture.postMessage.mockClear();
      fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
    },
  );

  it("resolves the visible quote when a collapsed duplicate also exists", () => {
    const collapsed = element("span", new TextNode("Revenue is $42"));
    collapsed.visibility = "collapse";
    const fixture = scriptFixture([collapsed, element("p", new TextNode("Revenue is $42"))]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { text: "Revenue is $42", start: 0, end: 14, prefix: "", suffix: "" },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it("reports unavailable when a saved quote is collapsed before navigation", () => {
    const wrapper = element("p", new TextNode("Revenue is $42"));
    const fixture = scriptFixture([wrapper]);
    const citation = fixture.capture();
    wrapper.visibility = "collapse";
    fixture.postMessage.mockClear();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
      params: { unavailable: true, requestId: "request" },
    });
  });

  it("ends highlighting when a text target becomes collapsed", () => {
    const wrapper = element("p", new TextNode("Revenue is $42"));
    const fixture = scriptFixture([wrapper]);
    const citation = fixture.capture();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    expect(fixture.outline().display).toBe("block");
    fixture.postMessage.mockClear();
    wrapper.visibility = "collapse";
    fixture.scroll();
    expect(fixture.outline().display).toBe("none");
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
      params: { highlightEnded: true, requestId: "request" },
    });
  });

  it.each([false, true])(
    "omits transparent text when spanning visible text, nested=%s",
    (nested) => {
      const secret = element("span", new TextNode(" secret"));
      secret.display = "inline";
      const transparent = nested ? element("span", secret) : secret;
      transparent.display = "inline";
      transparent.style.opacity = "0";
      const fixture = scriptFixture([
        element("p", new TextNode("Revenue"), transparent, new TextNode(" is $42")),
      ]);
      const citation = fixture.capture();
      expect(citation).toMatchObject({
        text: "Revenue is $42",
        start: 0,
        end: 14,
        prefix: "",
        suffix: "",
      });
      fixture.postMessage.mockClear();
      fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
    },
  );

  it("does not resolve a quote from invisible duplicate text", () => {
    const transparent = element("span", new TextNode("Revenue is $42"));
    transparent.style.opacity = "0";
    const fixture = scriptFixture([transparent, element("p", new TextNode("Revenue is $42"))]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { text: "Revenue is $42", start: 0, end: 14, prefix: "", suffix: "" },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it.each(["body", "html"] as const)(
    "does not capture text hidden by transparent %s",
    (ancestor) => {
      const fixture = scriptFixture([element("p", new TextNode("Revenue is $42"))]);
      fixture[ancestor].style.opacity = "0";
      fixture.capture();
      expect(fixture.postMessage).not.toHaveBeenCalled();
    },
  );

  it.each(["0.5", "0"])("keeps visible contents text with wrapper opacity %s", (opacity) => {
    const wrapper = element("span", new TextNode("Revenue is $42"));
    wrapper.display = "contents";
    wrapper.style.opacity = opacity;
    const partiallyTransparent = element("p", wrapper);
    partiallyTransparent.style.opacity = "0.5";
    const fixture = scriptFixture([partiallyTransparent]);
    const citation = fixture.capture();
    expect(citation?.text).toBe("Revenue is $42");
    fixture.postMessage.mockClear();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it.each([false, true])(
    "reveals visible content in a CSS-sized outer SVG, viewBox=%s",
    (hasViewBox) => {
      const target = new ElementNode("rect", { id: "bar" });
      target.rect = { left: 200, top: 10, width: 20, height: 20 };
      const viewport = new CssSvgViewport(target);
      viewport.width.animVal.value = 100;
      viewport.rect = { left: 0, top: 0, width: 300, height: 100 };
      viewport.viewBox.animVal = {
        x: 0,
        y: 0,
        width: hasViewBox ? 100 : 0,
        height: hasViewBox ? 100 : 0,
      };
      viewport.matrix = { a: 1, b: 0, c: 0, d: 1, e: hasViewBox ? 100 : 0, f: 0 };
      const fixture = scriptFixture([viewport]);
      fixture.control({
        action: "highlight",
        requestId: "request",
        duration: 2400,
        citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
      });
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
      expect(fixture.outline()).toMatchObject({
        left: "200px",
        top: "10px",
        width: "20px",
        height: "20px",
      });
    },
  );

  it("clips an outer SVG to its scaled CSS content box, including inside foreignObject", () => {
    const target = new ElementNode("rect", { id: "bar" });
    target.rect = { left: 580, top: 20, width: 40, height: 20 };
    const viewport = new CssSvgViewport(target);
    viewport.rect = { left: 0, top: 0, width: 616, height: 216 };
    Object.assign(viewport.style, {
      borderLeftWidth: "4px",
      borderRightWidth: "4px",
      borderTopWidth: "4px",
      borderBottomWidth: "4px",
      paddingLeft: "6px",
      paddingRight: "6px",
      paddingTop: "6px",
      paddingBottom: "6px",
    });
    viewport.width.animVal.value = 100;
    viewport.viewBox.animVal = { x: 0, y: 0, width: 0, height: 0 };
    viewport.matrix = { a: 2, b: 0, c: 0, d: 2, e: 20, f: 20 };
    const fixture = scriptFixture([element("svg", element("foreignObject", viewport))]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
    expect(fixture.outline()).toMatchObject({
      left: "580px",
      top: "20px",
      width: "16px",
      height: "20px",
    });
    target.rect.left = 600;
    fixture.postMessage.mockClear();
    fixture.control({
      action: "highlight",
      requestId: "outside",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
      params: { unavailable: true, requestId: "outside" },
    });
  });

  it.each([
    {
      name: "meet",
      align: 6,
      meetOrSlice: 1,
      matrix: { a: 2, b: 0, c: 0, d: 2, e: 100, f: 40 },
      expected: { left: "20px", top: "80px", width: "400px", height: "200px" },
    },
    {
      name: "slice",
      align: 6,
      meetOrSlice: 2,
      matrix: { a: 4, b: 0, c: 0, d: 4, e: -40, f: -100 },
      expected: { left: "0px", top: "80px", width: "400px", height: "200px" },
    },
    {
      name: "none",
      align: 1,
      meetOrSlice: 1,
      matrix: { a: 4, b: 0, c: 0, d: 2, e: -40, f: 40 },
      expected: { left: "0px", top: "80px", width: "400px", height: "200px" },
    },
  ])(
    "uses transformed viewport bounds for nested SVG with $name alignment",
    ({ align, meetOrSlice, matrix, expected }) => {
      const target = new ElementNode("rect", { id: "bar" });
      target.rect = { left: 0, top: 0, width: 500, height: 500 };
      const viewport = new SvgViewport(target);
      viewport.preserveAspectRatio.animVal = { align, meetOrSlice };
      viewport.matrix = matrix;
      const fixture = scriptFixture([element("svg", viewport)]);
      fixture.control({
        action: "highlight",
        requestId: "request",
        duration: 2400,
        citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
      });
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
      expect(fixture.outline()).toMatchObject(expected);
      expect(viewport.scrollLeft).toBe(0);
      expect(viewport.scrollTop).toBe(0);
    },
  );

  it("uses the whole nested SVG viewport without a viewBox", () => {
    const target = new ElementNode("rect", { id: "bar" });
    target.rect = { left: 100, top: 40, width: 500, height: 500 };
    const viewport = new SvgViewport(target);
    viewport.viewBox.animVal = { x: 0, y: 0, width: 0, height: 0 };
    const fixture = scriptFixture([element("svg", viewport)]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
    expect(fixture.outline()).toMatchObject({
      left: "100px",
      top: "40px",
      width: "400px",
      height: "200px",
    });
  });

  it("tracks a reopened element through inner scrolling without scrolling it back", () => {
    const target = new ElementNode("rect", { id: "bar" });
    target.rect = { left: 200, top: 200, width: 40, height: 30 };
    const scroller = element("div", target);
    scroller.rect = { left: 0, top: 0, width: 120, height: 80 };
    scroller.overflowX = "auto";
    scroller.overflowY = "auto";
    const fixture = scriptFixture([scroller]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.outline()).toMatchObject({ left: "80px", top: "50px" });
    scroller.scrollTo({ left: 150, top: 170 });
    fixture.scroll();
    expect(fixture.outline()).toMatchObject({ left: "50px", top: "30px" });
    expect(scroller.scrollLeft).toBe(150);
    expect(scroller.scrollTop).toBe(170);
    scroller.scrollTo({ left: 400, top: 400 });
    fixture.scroll();
    expect(fixture.outline().display).toBe("none");
    expect(scroller.scrollLeft).toBe(400);
    expect(fixture.postMessage.mock.calls.at(-1)?.[0]).toMatchObject({
      params: { highlightEnded: true, requestId: "request" },
    });
  });

  it("remeasures text outlines on viewport and ancestor resizing, then stops on expiry", () => {
    const text = new TextNode("Selected line");
    const wrapper = element("p", text);
    const fixture = scriptFixture([wrapper]);
    const citation = fixture.capture();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    text.rect.left = 40;
    fixture.resize();
    expect(fixture.outline().left).toBe("40px");
    text.rect.top = 60;
    fixture.resizeTarget(wrapper);
    expect(fixture.outline().top).toBe("60px");
    fixture.expire();
    text.rect.left = 80;
    fixture.resizeTarget(wrapper);
    fixture.scroll();
    expect(fixture.outline().display).toBe("none");
    expect(fixture.outline().left).toBe("40px");
  });

  it("captures and reveals direct text inside a contents wrapper", () => {
    const strong = element("strong", new TextNode("$42"));
    strong.display = "inline";
    const wrapper = element("span", new TextNode("Revenue is "), strong);
    wrapper.display = "contents";
    const fixture = scriptFixture([wrapper]);
    const citation = fixture.capture();
    expect(citation?.text).toBe("Revenue is $42");
    fixture.postMessage.mockClear();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it.each(["horizontal", "vertical"] as const)(
    "reveals a quote inside a %s scrolling container",
    (direction) => {
      const text = new TextNode("Selected line");
      text.rect = {
        left: direction === "horizontal" ? 400 : 0,
        top: direction === "vertical" ? 400 : 20,
        width: 80,
        height: 20,
      };
      const pre = element("pre", text);
      pre.rect = { left: 0, top: 0, width: 600, height: 600 };
      const scroller = element("div", pre);
      scroller.rect = { left: 0, top: 0, width: 120, height: 60 };
      scroller.overflowX = "auto";
      scroller.overflowY = "auto";
      const fixture = scriptFixture([scroller]);
      const citation = fixture.capture();
      fixture.postMessage.mockClear();
      fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
      const rect = positionedRect(text);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(120);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(60);
      expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
        params: { highlighted: true },
      });
    },
  );

  it("acknowledges readiness with the matching navigation identity", () => {
    const fixture = scriptFixture([]);
    fixture.control({ action: "ready", requestId: "request" });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({
      params: { ready: true, requestId: "request" },
    });
  });

  it("keeps adjacent inline text together", () => {
    const strong = element("strong", new TextNode("2"));
    strong.display = "inline";
    expect(scriptFixture([new TextNode("1"), strong]).capture()?.text).toBe("12");
  });

  it.each([
    ["line break", [new TextNode("1"), element("br"), new TextNode("2")]],
    ["blocks", [element("p", new TextNode("1")), element("p", new TextNode("2"))]],
    [
      "table cells",
      [
        element(
          "table",
          element("tr", element("td", new TextNode("1")), element("td", new TextNode("2"))),
        ),
      ],
    ],
  ])("preserves the rendered boundary between %s", (_name, children) => {
    const fixture = scriptFixture(children);
    const citation = fixture.capture();
    expect(citation?.text).toBe("1\n2");
    fixture.postMessage.mockClear();
    fixture.control({ action: "highlight", requestId: "request", duration: 2400, citation });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it("reports unavailable for unchanged markup below a hidden ancestor", () => {
    const target = new ElementNode("rect", { id: "bar" });
    const parent = element("div", target);
    parent.display = "none";
    const fixture = scriptFixture([parent]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { unavailable: true } });
  });

  it("can highlight a visible horizontal SVG stroke", () => {
    const target = new ElementNode("line", { id: "bar" });
    target.rect.height = 0;
    const fixture = scriptFixture([target]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "line", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { highlighted: true } });
  });

  it("reports unavailable when a target has no usable rectangle", () => {
    const target = new ElementNode("rect", { id: "bar" });
    target.rect.width = 0;
    target.rect.height = 0;
    const fixture = scriptFixture([target]);
    fixture.control({
      action: "highlight",
      requestId: "request",
      duration: 2400,
      citation: { element: { selector: "#bar", tagName: "rect", markup: target.outerHTML } },
    });
    expect(fixture.postMessage.mock.calls[0]?.[0]).toMatchObject({ params: { unavailable: true } });
  });
});

describe("visualization citation messages", () => {
  it("accepts bounded text and element selections without trusting source identity from the frame", () => {
    const selection = {
      text: "Revenue: $42",
      start: 0,
      end: 12,
      prefix: "",
      suffix: "",
      element: { selector: "#bar", tagName: "rect", markup: '<rect id="bar" width="42"></rect>' },
    };
    const message = {
      jsonrpc: "2.0",
      method: "t3/notifications/citation",
      params: { ...selection, threadId: "forged" },
    };
    expect(readHtmlRenderCitation(message)).toEqual(selection);
    for (const params of [
      null,
      { ...selection, end: 0 },
      { ...selection, text: "x".repeat(8001) },
      { ...selection, element: { ...selection.element, selector: "x".repeat(2001) } },
    ]) {
      expect(readHtmlRenderCitation({ ...message, params })).toBeUndefined();
    }
    expect(readHtmlRenderCitation({ ...message, method: "ui/open-link" })).toBeUndefined();
  });
});
