import type { AssistantCitation, EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import {
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFileName,
  htmlRenderFrameHeight,
  type HtmlRenderReference,
} from "@t3tools/shared/htmlRender";
import { Maximize2Icon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useStableCallback } from "~/hooks/useStableCallback";

import { useAssetUrlRefresh } from "~/assets/assetUrls";
import { useLongLivedAssetUrl } from "~/assets/longLivedAssetUrls";

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
  const observeBox = useStableCallback((box: HTMLDivElement) => {
    boxRef.current = box;
    setWidth(box.clientWidth);
    const stop = observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    return () => {
      boxRef.current = null;
      stop();
    };
  });
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
  // The frame keeps the first URL it loads, so later mints do not reload the page.
  const [loaded, setLoaded] = useState<{ src: string; expiresAt: number } | null>(null);
  const assetUrl = useLongLivedAssetUrl(loaded === null ? props.environmentId : null, resource);
  if (loaded === null && assetUrl._tag === "Success") {
    setLoaded({ src: assetUrl.url, expiresAt: assetUrl.expiresAt });
  }
  const src = loaded?.src ?? null;
  const failed = loaded === null && assetUrl._tag === "Failure";
  const refresh = useAssetUrlRefresh(props.environmentId, resource);
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  const { onFullscreenChange } = props;
  // Tied to the viewer's lifetime: unmounting while expanded must still release
  // the timeline's follow pin, which a close handler alone never reaches.
  const expanded = expandedSrc !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds the parent's fullscreen pin while expanded and releases it on collapse or unmount
  useEffect(() => {
    if (!expanded) return;
    onFullscreenChange?.(true);
    return () => onFullscreenChange?.(false);
  }, [expanded, onFullscreenChange]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own the iframe response timeout and report failed citation navigation while mounted.
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Scroll the virtualized list to keep the cited iframe mounted during navigation.
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
    <div ref={observeBox} className="group/html-render relative" style={{ height }}>
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
                        loaded !== null && loaded.expiresAt - Date.now() > MIN_URL_LIFE_MS
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
