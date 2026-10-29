import { HtmlRenderCitationSelection } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const HTML_RENDER_CITATION_METHOD = "t3/notifications/citation";
export const HTML_RENDER_CITATION_CONTROL_METHOD = "t3/citation";

const decodeSelection = Schema.decodeUnknownOption(HtmlRenderCitationSelection);

export function readHtmlRenderCitation(data: unknown) {
  if (typeof data !== "object" || data === null) return undefined;
  const message = data as Record<string, unknown>;
  if (message.jsonrpc !== "2.0" || message.method !== HTML_RENDER_CITATION_METHOD) return undefined;
  return Option.getOrUndefined(decodeSelection(message.params));
}

// Runs inside the opaque-origin document, which the client cannot inspect directly.
export const HTML_RENDER_CITATION_SCRIPT = String.raw`(function () {
  if (window.__t3Citations) return;
  window.__t3Citations = true;
  var enabled = false, picking = false, selection = null, box = null, action = null, highlightTimer = null, highlightStyle = null, activeHighlight = null, highlightObserver = null, previousCursor = "";
  var excluded = 'script,style,template,noscript,[hidden],[aria-hidden="true"],input,textarea,select,[contenteditable], [data-t3-citation-ui]';
  function send(params) {
    window.parent.postMessage({jsonrpc:"2.0",method:"t3/notifications/citation",params:params}, "*");
  }
  function isFullyTransparent(style) {
    // A contents wrapper has no box to composite with its opacity.
    return style.opacity === "0" && style.display !== "contents";
  }
  function textMap() {
    var text = "", chunks = [], separator = false;
    function visit(node) {
      if (node.nodeType === 3) {
        var parent = node.parentElement;
        if (!node.length || !parent || getComputedStyle(parent).visibility !== "visible") return;
        var fragment = document.createRange();
        fragment.selectNodeContents(node);
        if (!Array.from(fragment.getClientRects()).some(function (rect) { return rect.width > 0 && rect.height > 0; })) return;
        if (separator && text.length) text += "\n";
        separator = false;
        chunks.push({node:node,start:text.length,end:text.length+node.length});
        text += node.data;
        return;
      }
      if (node.nodeType !== 1 || node.matches(excluded)) return;
      var style = getComputedStyle(node), display = style.display;
      if (display === "none" || isFullyTransparent(style)) return;
      var block = /^(block|flow-root|flex|grid|list-item|table.*)$/.test(display);
      if (block || node.localName === "br") separator = true;
      node.childNodes.forEach(visit);
      if (block) separator = true;
    }
    for (var ancestor = document.body.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (isFullyTransparent(getComputedStyle(ancestor))) return {text:text,chunks:chunks};
    }
    visit(document.body);
    return {text:text,chunks:chunks};
  }
  function textSelector(range) {
    var map = textMap(), text = map.text, start = -1, end = -1;
    map.chunks.forEach(function (chunk) {
      var node = chunk.node;
      if (range.intersectsNode(node)) {
        var from = range.startContainer === node ? range.startOffset : 0;
        var to = range.endContainer === node ? range.endOffset : node.length;
        if (to > from) {
          if (start < 0) start = chunk.start + from;
          end = chunk.start + to;
        }
      }
    });
    if (start < 0 || end <= start) return null;
    var quote = text.slice(start, end);
    if (!quote.trim() || quote.length > 8000) return null;
    var prefix = text.slice(Math.max(0,start-32),start), suffix = text.slice(end,end+32);
    if (/^[\uDC00-\uDFFF]/.test(prefix)) prefix = prefix.slice(1);
    if (/[\uD800-\uDBFF]$/.test(suffix)) suffix = suffix.slice(0,-1);
    return {text:quote,start:start,end:end,prefix:prefix,suffix:suffix};
  }
  function ensureUi() {
    if (box) return;
    box = document.createElement("div");
    box.setAttribute("data-t3-citation-ui", "");
    box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid var(--primary,currentColor);box-sizing:border-box;display:none;border-radius:3px";
    action = document.createElement("button");
    action.type = "button";
    action.textContent = "Cite";
    action.setAttribute("data-t3-citation-ui", "");
    action.style.cssText = "position:fixed;z-index:2147483647;display:none;border:1px solid var(--border);border-radius:6px;padding:5px 10px;background:var(--popover,var(--background));color:var(--popover-foreground,var(--foreground));font:13px var(--font-sans,sans-serif);cursor:pointer";
    action.addEventListener("pointerdown", function (event) { event.preventDefault(); });
    action.addEventListener("click", function (event) {
      if (!event.isTrusted || !enabled || !selection) return;
      send(selection);
    });
    document.body.append(box, action);
  }
  function outline(rect) {
    ensureUi();
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
  }
  function clear() {
    if (box) box.style.display = "none";
    if (action) action.style.display = "none";
  }
  function clearHighlight() {
    if (highlightTimer !== null) clearTimeout(highlightTimer);
    highlightTimer = null;
    if (highlightStyle) highlightStyle.remove();
    highlightStyle = null;
    activeHighlight = null;
    if (highlightObserver) highlightObserver.disconnect();
    highlightObserver = null;
    if (CSS.highlights) CSS.highlights.delete("t3-visualization-citation");
    clear();
  }
  function endHighlight() {
    var active = activeHighlight;
    clearHighlight();
    if (active) send({highlightEnded:true,requestId:active.requestId});
  }
  function refreshOutline() {
    var active = activeHighlight;
    if (!active) { if (box) box.style.display = "none"; return; }
    var target = active.target;
    var visible = target.isConnected && (active.range || target.checkVisibility({visibilityProperty:true,opacityProperty:true}));
    var rect = visible ? reveal(target,active.range,false) : null;
    if (rect) outline(rect);
    else endHighlight();
  }
  window.addEventListener("scroll", refreshOutline, true);
  window.addEventListener("resize", refreshOutline);
  function setPicking(value) {
    clearHighlight();
    if (document.body && value !== picking) {
      if (value) { previousCursor = document.body.style.cursor; document.body.style.cursor = "crosshair"; }
      else document.body.style.cursor = previousCursor;
    }
    picking = value;
    clear();
  }
  function selectorFor(element) {
    var parts = [], current = element;
    while (current && current !== document.documentElement) {
      if (current.id) {
        var id = "#" + CSS.escape(current.id);
        if (document.querySelectorAll(id).length === 1) { parts.unshift(id); break; }
      }
      var index = 1, sibling = current.previousElementSibling;
      while (sibling) { if (sibling.localName === current.localName) index++; sibling = sibling.previousElementSibling; }
      parts.unshift(current.localName + ":nth-of-type(" + index + ")");
      current = current.parentElement;
    }
    return parts.join(" > ");
  }
  function elementSelection(element) {
    var copy = element.cloneNode(true);
    copy.querySelectorAll("script,style,[data-t3-citation-ui]").forEach(function (node) { node.remove(); });
    var markup = copy.outerHTML;
    if (markup.length > 8000) { send({error:"element-too-large"}); return null; }
    var label = (element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("title") || element.textContent || element.localName).trim();
    if (!label) label = element.localName;
    var selector = selectorFor(element);
    if (label.length > 8000 || selector.length > 2000) { send({error:"element-too-large"}); return null; }
    return {text:label,start:0,end:label.length,prefix:"",suffix:"",element:{selector:selector,tagName:element.localName,markup:markup}};
  }
  document.addEventListener("pointermove", function (event) {
    if (!enabled || !picking || !event.isTrusted) return;
    var element = event.target;
    if (!(element instanceof Element) || element.closest(excluded) || element === document.body || element === document.documentElement || element.localName === "canvas" || element.localName === "img") { clear(); return; }
    outline(element.getBoundingClientRect());
  }, true);
  window.addEventListener("click", function (event) {
    if (!enabled || !picking || !event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var element = event.target;
    if (!(element instanceof Element) || element.closest(excluded) || element === document.body || element === document.documentElement || element.localName === "canvas" || element.localName === "img") return;
    if (!element || !element.isConnected) return;
    var value = elementSelection(element);
    if (value) send(value);
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && picking) { setPicking(false); send({cancelled:true}); }
  }, true);
  document.addEventListener("selectionchange", function () {
    if (!enabled || picking || !document.body) return;
    var native = window.getSelection();
    if (!native || native.isCollapsed || native.rangeCount !== 1) { if (action) action.style.display = "none"; return; }
    var range = native.getRangeAt(0);
    selection = textSelector(range);
    if (!selection) { if (action) action.style.display = "none"; return; }
    ensureUi();
    var rect = range.getBoundingClientRect();
    action.style.display = "block";
    action.style.left = Math.max(4,Math.min(rect.right,innerWidth-action.offsetWidth-4)) + "px";
    action.style.top = Math.max(4,Math.min(rect.bottom+4,innerHeight-action.offsetHeight-4)) + "px";
  });
  function resolveText(citation) {
    var map = textMap(), text = map.text;
    var matches = [], at = text.indexOf(citation.text);
    while (at >= 0) { matches.push(at); at = text.indexOf(citation.text, at+1); }
    if (matches.length > 1) matches = matches.filter(function (at) { return text.slice(Math.max(0,at-citation.prefix.length),at) === citation.prefix && text.slice(at+citation.text.length,at+citation.text.length+citation.suffix.length) === citation.suffix; });
    if (matches.length !== 1) return null;
    var start = matches[0], end = start+citation.text.length, range = document.createRange(), found = false;
    map.chunks.forEach(function (chunk) {
      if (!found && start >= chunk.start && start < chunk.end) { range.setStart(chunk.node,start-chunk.start); found = true; }
      if (end > chunk.start && end <= chunk.end) range.setEnd(chunk.node,end-chunk.start);
    });
    return found ? range : null;
  }
  function svgViewportBounds(element, style) {
    var empty = {left:0,right:0,top:0,bottom:0}, parent = element.parentElement;
    if (!parent || parent.namespaceURI !== "http://www.w3.org/2000/svg" || parent.localName === "foreignObject") {
      var bounds = element.getBoundingClientRect();
      var bl = parseFloat(style.borderLeftWidth), br = parseFloat(style.borderRightWidth);
      var bt = parseFloat(style.borderTopWidth), bb = parseFloat(style.borderBottomWidth);
      var boxWidth = element.clientWidth+bl+br, boxHeight = element.clientHeight+bt+bb;
      if (!(boxWidth > 0 && boxHeight > 0)) return empty;
      var scaleX = bounds.width/boxWidth, scaleY = bounds.height/boxHeight;
      return {left:bounds.left+(bl+parseFloat(style.paddingLeft))*scaleX,right:bounds.right-(br+parseFloat(style.paddingRight))*scaleX,
        top:bounds.top+(bt+parseFloat(style.paddingTop))*scaleY,bottom:bounds.bottom-(bb+parseFloat(style.paddingBottom))*scaleY};
    }
    var matrix = element.getScreenCTM(), width = element.width.animVal.value, height = element.height.animVal.value;
    if (!matrix || !(width > 0 && height > 0)) return empty;
    var view = element.viewBox.animVal, aspect = element.preserveAspectRatio.animVal;
    var sx = 1, sy = 1, tx = 0, ty = 0;
    if (view.width > 0 && view.height > 0) {
      sx = width/view.width; sy = height/view.height;
      if (aspect.align !== 1) sx = sy = aspect.meetOrSlice === 2 ? Math.max(sx,sy) : Math.min(sx,sy);
      tx = -view.x*sx; ty = -view.y*sy;
      if (aspect.align !== 1) {
        tx += (width-view.width*sx)*((aspect.align-2)%3)/2;
        ty += (height-view.height*sy)*Math.floor((aspect.align-2)/3)/2;
      }
    }
    // getScreenCTM includes viewBox fitting; undo it before mapping the viewport's corners.
    var points = [[0,0],[width,0],[0,height],[width,height]].map(function (point) {
      var x = (point[0]-tx)/sx, y = (point[1]-ty)/sy;
      return {x:matrix.a*x+matrix.c*y+matrix.e,y:matrix.b*x+matrix.d*y+matrix.f};
    });
    if (!points.every(function (point) { return Number.isFinite(point.x) && Number.isFinite(point.y); })) return empty;
    return {left:Math.min.apply(null,points.map(function (p) { return p.x; })),right:Math.max.apply(null,points.map(function (p) { return p.x; })),
      top:Math.min.apply(null,points.map(function (p) { return p.y; })),bottom:Math.max.apply(null,points.map(function (p) { return p.y; }))};
  }
  function reveal(target, range, scroll) {
    function rectangles() { return range ? Array.from(range.getClientRects()) : [target.getBoundingClientRect()]; }
    function clip(element) {
      var style = getComputedStyle(element), viewport = element === document.scrollingElement;
      if (style.display === "contents") return null;
      var x = viewport || style.overflowX !== "visible", y = viewport || style.overflowY !== "visible";
      if (!x && !y) return null;
      if (element instanceof SVGSVGElement) {
        var svg = svgViewportBounds(element,style);
        return {left:x?svg.left:-Infinity,right:x?svg.right:Infinity,top:y?svg.top:-Infinity,bottom:y?svg.bottom:Infinity,
          sx:1,sy:1,scrollX:false,scrollY:false};
      }
      var bounds = element.getBoundingClientRect();
      var sx = !viewport && element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
      var sy = !viewport && element.offsetHeight > 0 ? bounds.height / element.offsetHeight : 1;
      var left = viewport ? 0 : bounds.left + element.clientLeft * sx;
      var top = viewport ? 0 : bounds.top + element.clientTop * sy;
      return {left:x?left:-Infinity,right:x?left+(viewport?innerWidth:element.clientWidth*sx):Infinity,
        top:y?top:-Infinity,bottom:y?top+(viewport?innerHeight:element.clientHeight*sy):Infinity,
        sx:sx,sy:sy,scrollX:x && style.overflowX !== "clip",scrollY:y && style.overflowY !== "clip"};
    }
    var rects = rectangles(), index = rects.findIndex(function (rect) { return rect.width > 0 || rect.height > 0; });
    if (index < 0 || getComputedStyle(target).visibility !== "visible") return null;
    var ancestors = [], parent = range ? target : target.parentElement;
    for (; parent; parent = parent.parentElement) {
      var style = getComputedStyle(parent);
      if (style.display === "none" || isFullyTransparent(style) || style.contentVisibility === "hidden") return null;
      ancestors.push(parent);
      var box = clip(parent), rect = rectangles()[index];
      if (!box || !rect || scroll === false) continue;
      var dx = rect.left < box.left || rect.width > box.right-box.left ? rect.left-box.left : Math.max(0,rect.right-box.right);
      var dy = rect.top < box.top || rect.height > box.bottom-box.top ? rect.top-box.top : Math.max(0,rect.bottom-box.bottom);
      if ((box.scrollX && dx) || (box.scrollY && dy)) parent.scrollTo({
        left:parent.scrollLeft+(box.scrollX?dx/box.sx:0),top:parent.scrollTop+(box.scrollY?dy/box.sy:0),behavior:"instant"});
    }
    rects = rectangles();
    for (var i=0;i<rects.length;i++) {
      var rect = rects[i];
      if (!(rect.width > 0 || rect.height > 0)) continue;
      var left=rect.left,top=rect.top,right=rect.left+Math.max(1,rect.width),bottom=rect.top+Math.max(1,rect.height);
      for (var j=0;j<ancestors.length;j++) {
        var box=clip(ancestors[j]);
        if (box) { left=Math.max(left,box.left);right=Math.min(right,box.right);top=Math.max(top,box.top);bottom=Math.min(bottom,box.bottom); }
      }
      left=Math.max(left,0);right=Math.min(right,innerWidth);top=Math.max(top,0);bottom=Math.min(bottom,innerHeight);
      if (right>left && bottom>top) return {left:left,top:top,width:right-left,height:bottom-top};
    }
    return null;
  }
  window.addEventListener("message", function (event) {
    var message = event.data, params = message && message.params;
    if (event.source !== window.parent || !message || message.jsonrpc !== "2.0" || message.method !== "t3/citation" || !params) return;
    if (params.action === "enable") { enabled = true; return; }
    if (params.action === "ready") { send({ready:true,requestId:params.requestId}); return; }
    if (params.action === "cited") {
      if (params.accepted === true) { setPicking(false); window.getSelection().removeAllRanges(); }
      return;
    }
    if (params.action === "pick") { if (enabled) setPicking(params.active === true); return; }
    if (params.action === "clear") { clearHighlight(); setPicking(false); return; }
    if (params.action !== "highlight" || !params.citation) return;
    var citation = params.citation, target = null, range = null;
    clearHighlight();
    if (citation.element) {
      try {
        var matches = document.querySelectorAll(citation.element.selector);
        if (matches.length === 1 && matches[0].localName === citation.element.tagName) {
          var candidate = matches[0], copy = candidate.cloneNode(true);
          copy.querySelectorAll("script,style,[data-t3-citation-ui]").forEach(function (node) { node.remove(); });
          if (copy.outerHTML === citation.element.markup) target = candidate;
        }
      } catch (_) {}
    } else { range = resolveText(citation); target = range && range.startContainer.parentElement; }
    if (!target) { send({unavailable:true,requestId:params.requestId}); return; }
    var rect = (!range && !target.checkVisibility({visibilityProperty:true,opacityProperty:true})) ? null : reveal(target,range);
    if (!rect) {
      send({unavailable:true,requestId:params.requestId});
      return;
    }
    outline(rect);
    activeHighlight = {target:target,range:range,requestId:params.requestId};
    highlightObserver = new ResizeObserver(refreshOutline);
    for (var observed = target; observed; observed = observed.parentElement) highlightObserver.observe(observed);
    if (range && typeof Highlight !== "undefined" && CSS.highlights) {
      highlightStyle = document.createElement("style");
      highlightStyle.setAttribute("data-t3-citation-ui", "");
      highlightStyle.textContent = "::highlight(t3-visualization-citation){background:var(--primary);color:var(--primary-foreground)}";
      document.head.append(highlightStyle);
      CSS.highlights.set("t3-visualization-citation", new Highlight(range));
    }
    send({highlighted:true,top:rect.top,requestId:params.requestId});
    highlightTimer = setTimeout(endHighlight, Math.min(2400,Math.max(0,params.duration)));
  });
})();`;
