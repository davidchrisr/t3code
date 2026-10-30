import type { AssistantCitation, ScopedThreadRef } from "@t3tools/contracts";
import {
  HTML_RENDER_CITATION_CONTROL_METHOD,
  HTML_RENDER_CITATION_METHOD,
  readHtmlRenderCitation,
} from "@t3tools/shared/htmlRenderCitations";
import { MousePointer2Icon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager } from "../ui/toast";
import type { AssistantCitationTarget } from "./AssistantCitationSource";

export interface HtmlRenderCitationContext {
  readonly attachmentId: string;
  readonly onCite?: ((citation: AssistantCitation) => boolean) | undefined;
  readonly request?: AssistantCitationTarget | null | undefined;
  readonly onHighlight?: ((top: number) => void) | undefined;
}

function dismissHtmlRenderCitation(request: AssistantCitationTarget) {
  request.activationRef.current.dismissed = true;
  if (!request.activationRef.current.scrolled) request.onComplete();
}

function htmlRenderCitationHighlightDuration(request: AssistantCitationTarget) {
  const activation = request.activationRef.current;
  const startedAt = (activation.pulse ??= {
    startedAt: performance.now(),
    reducedMotion: true,
  }).startedAt;
  const duration = Math.max(0, 2400 - (performance.now() - startedAt));
  return duration;
}

export function HtmlRenderCitationControls({
  frameRef,
  loaded,
  title,
  threadRef,
  context,
}: {
  frameRef: RefObject<HTMLIFrameElement | null>;
  loaded: boolean;
  title: string;
  threadRef: ScopedThreadRef;
  context: HtmlRenderCitationContext;
}) {
  const [picking, setPicking] = useState(false);
  const post = useStableCallback((params: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(
      {
        jsonrpc: "2.0",
        method: HTML_RENDER_CITATION_CONTROL_METHOD,
        params,
      },
      "*",
    );
  });
  const highlight = useEffectEvent(() => {
    const request = context.request;
    if (
      !request ||
      request.citation.version !== 2 ||
      request.citation.htmlRender.attachmentId !== context.attachmentId ||
      request.activationRef.current.dismissed
    )
      return;
    const duration = htmlRenderCitationHighlightDuration(request);
    if (duration === 0) {
      dismissHtmlRenderCitation(request);
      return;
    }
    post({
      action: "highlight",
      requestId: request.key,
      duration,
      citation: {
        text: request.citation.text,
        start: request.citation.start,
        end: request.citation.end,
        prefix: request.citation.prefix,
        suffix: request.citation.suffix,
        element: request.citation.htmlRender.element,
      },
    });
  });
  const receive = useEffectEvent((event: MessageEvent) => {
    const frame = frameRef.current;
    if (!frame || event.source !== frame.contentWindow) return;
    const message: unknown = event.data;
    if (
      typeof message !== "object" ||
      message === null ||
      !("method" in message) ||
      message.method !== HTML_RENDER_CITATION_METHOD ||
      !("params" in message) ||
      typeof message.params !== "object" ||
      message.params === null
    )
      return;
    const params = message.params;
    if (
      ("ready" in params ||
        "highlighted" in params ||
        "unavailable" in params ||
        "highlightEnded" in params) &&
      (!("requestId" in params) ||
        params.requestId !== context.request?.key ||
        context.request?.activationRef.current.dismissed)
    )
      return;
    if ("ready" in params && params.ready === true) {
      highlight();
      return;
    }
    if ("highlightEnded" in params && params.highlightEnded === true && context.request) {
      dismissHtmlRenderCitation(context.request);
      return;
    }
    if (
      "highlighted" in params &&
      params.highlighted === true &&
      "top" in params &&
      typeof params.top === "number" &&
      Number.isFinite(params.top)
    ) {
      context.onHighlight?.(params.top);
      return;
    }
    if ("unavailable" in params && params.unavailable === true) {
      context.onHighlight?.(0);
      toastManager.add({
        type: "warning",
        title: "The cited selection has changed",
        description: "Your saved citation is unchanged.",
      });
      return;
    }
    if (document.activeElement !== frame || navigator.userActivation?.isActive === false) return;
    if ("cancelled" in params) {
      setPicking(false);
      return;
    }
    if ("error" in params && params.error === "element-too-large") {
      toastManager.add({
        type: "warning",
        title: "This element is too large to cite",
        description: "Select a smaller element or quote its text.",
      });
      return;
    }
    const selection = readHtmlRenderCitation(event.data);
    if (!selection || !context.onCite) return;
    const { element, ...quote } = selection;
    const citation: AssistantCitation = {
      version: 2,
      ...threadRef,
      ...quote,
      htmlRender: { attachmentId: context.attachmentId, title, ...(element ? { element } : {}) },
    };
    const accepted = context.onCite(citation);
    post({ action: "cited", accepted });
    if (accepted) setPicking(false);
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe to notifications from the sandboxed visualization frame.
  useEffect(() => {
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize citation availability with each loaded iframe document.
  useEffect(() => {
    if (loaded && context.onCite) post({ action: "enable" });
  }, [loaded, context.onCite, post]);
  const request = context.request;
  // oxlint-disable-next-line t3code/react-effect-budget -- Synchronize the active citation request with the opaque iframe and clear it on cleanup.
  useEffect(() => {
    if (
      !loaded ||
      !request ||
      request.citation.version !== 2 ||
      request.citation.htmlRender.attachmentId !== context.attachmentId ||
      request.activationRef.current.dismissed
    )
      return;
    post({ action: "ready", requestId: request.key });
    return () => post({ action: "clear" });
  }, [loaded, request, context.attachmentId, post]);

  if (!context.onCite) return null;
  return (
    <div className="absolute end-10 top-2 z-10">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="glass"
              aria-label={picking ? "Cancel element citation" : "Cite element"}
              aria-pressed={picking}
              disabled={!loaded}
              onClick={() => {
                post({ action: "pick", active: !picking });
                setPicking(!picking);
                frameRef.current?.focus();
              }}
            >
              {picking ? (
                <XIcon className="size-3.5" />
              ) : (
                <MousePointer2Icon className="size-3.5" />
              )}
            </Button>
          }
        />
        <TooltipPopup>
          {picking ? "Cancel element citation (Esc)" : "Cite an HTML or SVG element"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
