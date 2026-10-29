import type { AssistantCitation, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { useAssetUrlRefresh, useAssetUrlState } from "~/assets/assetUrls";

import { HtmlRenderDocument } from "../files/BrowserDocumentFrame";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { HtmlRenderDialog } from "./HtmlRenderDialog";
import { observeResize } from "~/lib/observeResize";
import type { AssistantCitationSourceAnchor } from "~/lib/assistantTextSelection";
import type { AssistantCitationTarget } from "./AssistantCitationSource";
import {
  failHtmlRenderCitationNavigation,
  watchHtmlRenderCitationNavigation,
} from "~/lib/htmlRenderCitationNavigation";

const MIN_URL_LIFE_MS = 5 * 60_000;

export function HtmlRenderFrame(props: {
  readonly environmentId: EnvironmentId;
  readonly htmlRender: HtmlRenderReference;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly onFullscreenChange?: (fullscreen: boolean) => void;
  readonly onCite?:
    | ((citation: AssistantCitation, anchor: AssistantCitationSourceAnchor) => boolean)
    | undefined;
  readonly citationRequest?: AssistantCitationTarget | null | undefined;
  readonly listRef?: RefObject<LegendListRef | null> | undefined;
  readonly itemKey?: string | undefined;
}) {
  const { attachmentId, title } = props.htmlRender;
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
  }, []);
  // Client fonts can exceed the server-measured height and cause nested scrolling.
  const [contentHeight, setContentHeight] = useState<number>();
  const height = htmlRenderFrameHeight(props.htmlRender, width, contentHeight);
  const fileName = htmlRenderFileName(title);
  const resource = {
    _tag: "attachment" as const,
    attachmentId,
    fileName,
    mimeType: "text/html",
    disposition: "inline" as const,
    renderIntent: "html-render" as const,
  };
  // Re-mint near-expiry URLs because frames cannot report failed loads.
  const [src, setSrc] = useState<string | null>(null);
  const srcExpiresAt = useRef(0);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const { onFullscreenChange } = props;
  useEffect(() => {
    if (expandedSrc === null) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [expandedSrc, onFullscreenChange]);
  const [failed, setFailed] = useState(false);
  const assetUrl = useAssetUrlState(src === null ? props.environmentId : null, resource);
  const cachedUrl = assetUrl._tag === "Success" ? assetUrl.url : null;
  const cachedExpiresAt = assetUrl._tag === "Success" ? assetUrl.expiresAt : 0;
  const cacheFailed = assetUrl._tag === "Failure";
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  // Mint once per mount to prevent clock skew from causing repeated mints.
  const minting = useRef(false);
  useEffect(() => {
    if (src !== null || minting.current) return;
    if (cacheFailed) {
      // oxlint-disable-next-line react/set-state-in-effect -- Mirrors the cached URL's failure.
      setFailed(true);
      return;
    }
    if (cachedUrl === null) return;
    if (cachedExpiresAt - Date.now() > MIN_URL_LIFE_MS) {
      srcExpiresAt.current = cachedExpiresAt;
      setSrc(cachedUrl);
      return;
    }
    minting.current = true;
    void refresh().then(
      (url) => (url === null ? setFailed(true) : setSrc(url)),
      () => setFailed(true),
    );
  }, [cacheFailed, cachedExpiresAt, cachedUrl, refresh, src]);

  useEffect(() => {
    const onFailure = () =>
      toastManager.add({
        type: "warning",
        title: "Could not open the cited visualization",
        description:
          "The page could not be loaded or did not respond. Your saved citation is unchanged.",
      });
    if (failed) {
      if (failHtmlRenderCitationNavigation(props.citationRequest, attachmentId)) onFailure();
      return;
    }
    return watchHtmlRenderCitationNavigation({
      request: props.citationRequest,
      attachmentId,
      onFailure,
    });
  }, [attachmentId, failed, props.citationRequest]);

  useEffect(() => {
    const request = props.citationRequest;
    const list = props.listRef?.current;
    if (
      !request ||
      request.citation.version !== 2 ||
      request.citation.htmlRender.attachmentId !== attachmentId ||
      request.activationRef.current.scrolled ||
      request.activationRef.current.dismissed ||
      !list ||
      !props.itemKey
    )
      return;
    const index = list.getState().indexByKey(props.itemKey);
    if (index !== undefined)
      void list.scrollToIndex({ index, animated: false }).catch(() => {
        if (request.activationRef.current.dismissed) return;
        request.activationRef.current.dismissed = true;
        request.onComplete();
        toastManager.add({
          type: "warning",
          title: "Could not open the cited visualization",
          description: "Click the citation to try again.",
        });
      });
  }, [attachmentId, props.citationRequest, props.itemKey, props.listRef]);

  const cite = props.onCite
    ? (citation: AssistantCitation) => {
        const source = boxRef.current;
        const viewport = source?.closest<HTMLElement>("[data-assistant-citation-viewport]");
        const frame = source?.querySelector("iframe");
        if (!source || !viewport || !frame) return false;
        const range = document.createRange();
        range.selectNode(frame);
        return props.onCite?.(citation, { source, range, viewport }) ?? false;
      }
    : undefined;
  const onHighlight = (top: number) => {
    const request = props.citationRequest;
    const list = props.listRef?.current;
    const source = boxRef.current;
    if (
      !request ||
      request.citation.version !== 2 ||
      request.citation.htmlRender.attachmentId !== attachmentId ||
      request.activationRef.current.scrolled ||
      request.activationRef.current.dismissed ||
      !list ||
      !source
    )
      return;
    const scroll = list.getScrollableNode();
    if (!(scroll instanceof HTMLElement)) return;
    const offset = Math.max(
      0,
      Math.min(
        scroll.scrollHeight - scroll.clientHeight,
        list.getState().scroll +
          source.getBoundingClientRect().top +
          top -
          scroll.getBoundingClientRect().top -
          Math.min(120, scroll.clientHeight / 3),
      ),
    );
    void list.scrollToOffset({ offset, animated: false }).then(
      () => {
        if (request.activationRef.current.dismissed) return;
        request.activationRef.current.scrolled = true;
        request.onComplete();
      },
      () => {
        if (request.activationRef.current.dismissed) return;
        request.activationRef.current.dismissed = true;
        request.onComplete();
        toastManager.add({
          type: "warning",
          title: "Could not open the cited visualization",
          description: "Click the citation to try again.",
        });
      },
    );
  };
  const citation = { attachmentId, onCite: cite, request: props.citationRequest, onHighlight };

  return (
    <div ref={boxRef} className="group/html-render relative" style={{ height }}>
      {src !== null ? (
        <>
          <HtmlRenderDocument
            src={src}
            title={title}
            threadRef={props.threadRef}
            className="block size-full"
            onContentHeight={setContentHeight}
            onFullscreenChange={onFullscreenChange}
            citation={citation}
          />
          <div className="absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/html-render:opacity-100 pointer-coarse:opacity-100">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Open full screen"
                    size="icon-xs"
                    variant="glass"
                    onClick={async () => {
                      const url =
                        srcExpiresAt.current - Date.now() > MIN_URL_LIFE_MS
                          ? src
                          : await refresh().catch(() => null);
                      if (url !== null) setExpandedSrc(url);
                      else
                        toastManager.add({
                          type: "error",
                          title: "Page unavailable",
                          description: "Reconnect to the environment and try again.",
                        });
                    }}
                  />
                }
              >
                <Maximize2Icon className="size-3.5" />
              </TooltipTrigger>
              <TooltipPopup side="left">Open full screen</TooltipPopup>
            </Tooltip>
          </div>
          {expandedSrc !== null ? (
            <HtmlRenderDialog
              src={expandedSrc}
              title={title}
              threadRef={props.threadRef}
              onClose={() => setExpandedSrc(null)}
              citation={{
                ...citation,
                onCite: props.onCite
                  ? (value) => {
                      if (!cite?.(value)) return false;
                      setExpandedSrc(null);
                      return true;
                    }
                  : undefined,
              }}
            />
          ) : null}
        </>
      ) : failed ? (
        <p className="flex size-full items-center justify-center text-muted-foreground text-xs">
          Unable to load {title}
        </p>
      ) : null}
    </div>
  );
}
