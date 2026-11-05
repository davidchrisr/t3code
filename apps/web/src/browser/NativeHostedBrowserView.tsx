import type { DesktopPreviewPresentationInput } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { previewBridge } from "~/components/preview/previewBridge";
import { usePreviewBridge } from "~/components/preview/usePreviewBridge";
import { useClientSettingsHydrated } from "~/hooks/useSettings";

import type { HostedBrowserViewProps } from "./HostedBrowserWebview";
import { BrowserDeviceToolbar } from "./BrowserDeviceToolbar";
import { BrowserViewportResizeHandles } from "./BrowserViewportResizeHandles";
import { resolveBrowserSurfacePanelRect, useBrowserSurfaceStore } from "./browserSurfaceStore";
import {
  browserViewportSettingKey,
  resolveBrowserViewportLayout,
  resolveFittedBrowserViewport,
} from "./browserViewportLayout";
import { acquireDesktopTab, withDesktopTab } from "./desktopTabLifetime";
import { readNativeBrowserCursor } from "./nativeBrowserCursor";
import { nativeBrowserIsOccluded, observeNativeBrowserOcclusion } from "./nativeBrowserOcclusion";
import { useBrowserLayoutZoomFactor } from "./useBrowserLayoutZoomFactor";
import { useBrowserViewportResize } from "./useBrowserViewportResize";

export function NativeHostedBrowserView(props: HostedBrowserViewProps) {
  const {
    threadRef,
    tabId,
    runtimeTabId,
    initialUrl,
    profileId,
    pictureInPicture,
    viewport,
    zoomFactor,
    serverDriven = false,
    serverRendering,
  } = props;
  const hydrated = useClientSettingsHydrated();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspectRatioLocked, setAspectRatioLocked] = useState(false);
  const lastNativePresentation = useRef<DesktopPreviewPresentationInput["nativeView"]>(undefined);
  const presentation = useBrowserSurfaceStore(
    useShallow((state) => {
      const current = state.byTabId[runtimeTabId];
      return {
        rect: resolveBrowserSurfacePanelRect(state.byTabId, runtimeTabId),
        visible: current?.visible ?? false,
        interactive: current?.interactive ?? true,
        cornerRadius: current?.cornerRadius ?? 0,
        zIndex: current?.zIndex ?? 30,
        fitSourceContent: current?.fitSourceContent ?? false,
        fittedSourceContent: current?.fittedSourceContent ?? null,
      };
    }),
  );
  usePreviewBridge({ threadRef, tabId, runtimeTabId, serverDriven });
  const active = presentation.visible && presentation.rect !== null;
  const layoutZoomFactor = useBrowserLayoutZoomFactor(zoomFactor);
  const fixedWidth = viewport._tag === "fill" ? null : viewport.width;
  const fixedHeight = viewport._tag === "fill" ? null : viewport.height;
  const containerSize = presentation.rect ?? { width: 1280, height: 800 };
  const deviceToolbarVisible = active && viewport._tag !== "fill" && !presentation.fitSourceContent;
  const aspectRatio =
    aspectRatioLocked && fixedWidth !== null && fixedHeight !== null
      ? fixedWidth / fixedHeight
      : null;
  const {
    activeDrag,
    commitViewportChange,
    effectiveViewport,
    handleResizeKeyDown,
    handleResizePointerDown,
    layout: viewportLayout,
  } = useBrowserViewportResize({
    target: { threadRef, tabId, runtimeTabId },
    viewport,
    zoomFactor: layoutZoomFactor,
    containerSize,
    deviceToolbarVisible,
    aspectRatio,
  });
  const fitted = presentation.fitSourceContent
    ? resolveFittedBrowserViewport(viewport, presentation.fittedSourceContent, layoutZoomFactor)
    : null;
  const layout = fitted
    ? resolveBrowserViewportLayout(containerSize, fitted, layoutZoomFactor)
    : viewportLayout;
  const [initialSrc] = useState(() => initialUrl ?? "about:blank");
  const [initialSize] = useState(() => ({
    width: viewport._tag === "fill" ? 1280 : viewport.width,
    height: viewport._tag === "fill" ? 800 : viewport.height,
  }));

  const report = useEffectEvent(() => {
    const element = pageRef.current;
    if (!element || !previewBridge?.updatePresentation) return;
    const rect = element.getBoundingClientRect();
    const hostZoom = window.desktopBridge?.getWindowZoomFactor() ?? 1;
    const previous = lastNativePresentation.current;
    const scale = active ? layout.viewportScale : (previous?.scale ?? 1);
    const bounds = active
      ? {
          x: Math.round(rect.x * hostZoom),
          y: Math.round(rect.y * hostZoom),
          width: Math.max(1, Math.round(rect.width * hostZoom)),
          height: Math.max(1, Math.round(rect.height * hostZoom)),
        }
      : {
          x: 0,
          y: 0,
          width:
            fixedWidth === null
              ? (previous?.bounds.width ?? 1280)
              : Math.max(1, Math.round(fixedWidth * zoomFactor * scale)),
          height:
            fixedHeight === null
              ? (previous?.bounds.height ?? 800)
              : Math.max(1, Math.round(fixedHeight * zoomFactor * scale)),
        };
    const panelVisible =
      active &&
      !document.hidden &&
      rect.width > 0 &&
      rect.height > 0 &&
      !nativeBrowserIsOccluded(rect);
    const contentSize = active
      ? {
          width: (layout.viewportWidth / scale) * hostZoom,
          height: (layout.viewportHeight / scale) * hostZoom,
        }
      : {
          width:
            fixedWidth === null ? (previous?.contentSize.width ?? 1280) : fixedWidth * zoomFactor,
          height:
            fixedHeight === null ? (previous?.contentSize.height ?? 800) : fixedHeight * zoomFactor,
        };
    const nativeView = {
      bounds,
      cursor: panelVisible ? readNativeBrowserCursor(rect, runtimeTabId, hostZoom) : null,
      contentSize,
      visible: panelVisible,
      scale,
      cornerRadius: presentation.cornerRadius * hostZoom,
      interactive: presentation.interactive,
      zIndex: presentation.zIndex,
    };
    lastNativePresentation.current = nativeView;
    const visible = pictureInPicture || panelVisible;
    useBrowserSurfaceStore.getState().presentContent(runtimeTabId, {
      x: layout.viewportX,
      y: layout.viewportY,
      width: layout.viewportWidth,
      height: layout.viewportHeight,
      scale: layout.viewportScale,
      scrollLeft: 0,
      scrollTop: 0,
    });
    withDesktopTab(runtimeTabId, async () => {
      try {
        await previewBridge?.updatePresentation?.({ tabId: runtimeTabId, visible, nativeView });
      } catch (cause) {
        setError(String(cause));
      }
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- creates the native page for this tab independently of panel visibility
  useEffect(() => {
    if (!hydrated) return;
    let disposed = false;
    const lease = acquireDesktopTab(
      runtimeTabId,
      serverDriven ? { threadId: threadRef.threadId, tabId } : undefined,
      {
        nativeView: {
          environmentId: threadRef.environmentId,
          ...(profileId === undefined ? {} : { profileId }),
          initialUrl: initialSrc,
          ...initialSize,
        },
      },
    );
    void lease.ready.then(
      () => {
        if (!disposed) report();
      },
      (cause: unknown) => {
        if (!disposed) setError(String(cause));
      },
    );
    return () => {
      disposed = true;
      lease.release();
    };
  }, [
    hydrated,
    runtimeTabId,
    serverDriven,
    tabId,
    threadRef.threadId,
    threadRef.environmentId,
    profileId,
    initialSrc,
    initialSize,
  ]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports the native panel or PiP to desktop idle-tab protection
  useEffect(() => {
    const bridge = previewBridge;
    if (!hydrated || !bridge || !serverDriven) return;
    withDesktopTab(runtimeTabId, () => bridge.setShown(runtimeTabId, active || pictureInPicture));
    return () => withDesktopTab(runtimeTabId, () => bridge.setShown(runtimeTabId, false));
  }, [hydrated, runtimeTabId, serverDriven, active, pictureInPicture]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- guest focus crosses Electron views, so replay it for host popup dismissal
  useEffect(
    () =>
      previewBridge?.onNativeFocus?.((focusedTab) => {
        if (focusedTab === runtimeTabId)
          pageRef.current?.dispatchEvent(
            new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
          );
      }),
    [runtimeTabId],
  );

  const serverColorScheme = serverRendering?.colorScheme;
  const serverZoomFactor = serverRendering?.zoomFactor;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies the server's browser appearance to the native page
  useEffect(() => {
    if (!hydrated || serverColorScheme === undefined) return;
    withDesktopTab(runtimeTabId, async () => {
      await previewBridge?.setColorScheme(runtimeTabId, serverColorScheme);
    });
  }, [hydrated, runtimeTabId, serverColorScheme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies server-owned zoom through the native browser bridge
  useEffect(() => {
    if (!hydrated || serverZoomFactor === undefined) return;
    withDesktopTab(runtimeTabId, async () => {
      await previewBridge?.setZoomFactor(runtimeTabId, serverZoomFactor);
    });
  }, [hydrated, runtimeTabId, serverZoomFactor]);

  /* oxlint-disable react/exhaustive-effect-dependencies -- Committed panel geometry and interaction changes must trigger the EffectEvent report. */
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- commits panel bounds and parks the native page when host overlays overlap it
  useLayoutEffect(() => {
    if (!hydrated || !pageRef.current) return;
    report();
    return observeNativeBrowserOcclusion(pageRef.current, report, runtimeTabId);
  }, [
    hydrated,
    active,
    pictureInPicture,
    runtimeTabId,
    layout.viewportX,
    layout.viewportY,
    layout.viewportWidth,
    layout.viewportHeight,
    layout.viewportScale,
    fixedWidth,
    fixedHeight,
    zoomFactor,
    presentation.cornerRadius,
    presentation.interactive,
    presentation.zIndex,
    presentation.rect?.x,
    presentation.rect?.y,
  ]);
  /* oxlint-enable react/exhaustive-effect-dependencies */
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the renderer's native panel placement when the tab host unmounts
  useEffect(
    () => () => {
      const nativeView = lastNativePresentation.current;
      if (nativeView)
        withDesktopTab(runtimeTabId, async () => {
          await previewBridge?.updatePresentation?.({
            tabId: runtimeTabId,
            visible: false,
            nativeView: { ...nativeView, visible: false },
          });
        });
    },
    [runtimeTabId],
  );

  if (!hydrated) return null;
  return (
    <div
      className="fixed overflow-hidden bg-muted/35"
      style={{
        left: active ? (presentation.rect?.x ?? 0) : 0,
        top: active ? (presentation.rect?.y ?? 0) : 0,
        width: containerSize.width,
        height: containerSize.height,
        zIndex: presentation.zIndex,
        visibility: active ? "visible" : "hidden",
        borderRadius: presentation.cornerRadius,
      }}
      data-preview-viewport={runtimeTabId}
    >
      {deviceToolbarVisible && effectiveViewport._tag !== "fill" ? (
        <BrowserDeviceToolbar
          setting={effectiveViewport}
          width={containerSize.width}
          aspectRatio={aspectRatio}
          onAspectRatioChange={(ratio) => setAspectRatioLocked(ratio !== null)}
          onChange={commitViewportChange}
        />
      ) : null}
      <div
        ref={pageRef}
        data-preview-tab={runtimeTabId}
        data-preview-server-tab={tabId}
        data-preview-native="true"
        data-preview-viewport-mode={effectiveViewport._tag}
        data-preview-viewport-key={browserViewportSettingKey(effectiveViewport)}
        style={{
          position: "absolute",
          left: layout.viewportX,
          top: layout.viewportY,
          width: layout.viewportWidth,
          height: layout.viewportHeight,
        }}
      />
      {active && effectiveViewport._tag !== "fill" && !fitted ? (
        <BrowserViewportResizeHandles
          layout={layout}
          activeDirection={activeDrag?.direction ?? null}
          onPointerDown={handleResizePointerDown}
          onKeyDown={handleResizeKeyDown}
        />
      ) : null}
      {error && active ? (
        <p role="alert" className="relative p-3 text-sm text-destructive">
          Browser preview failed: {error}
        </p>
      ) : null}
    </div>
  );
}
