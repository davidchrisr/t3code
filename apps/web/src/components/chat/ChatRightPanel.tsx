import { usePreviewPanelInlineSize } from "../../hooks/usePreviewPanelInlineSize";
import { RightPanelSheet } from "../RightPanelSheet";
import { RightPanelTabs, type RightPanelTabsProps } from "../RightPanelTabs";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { MobileTerminalSheet } from "../terminal/MobileTerminalSheet";
import type { ScopedThreadRef } from "@t3tools/contracts";

type ChatRightPanelProps = Omit<RightPanelTabsProps, "mode" | "inlineSize" | "maximized"> & {
  readonly threadRef: ScopedThreadRef;
  readonly sheet: boolean;
  readonly maximized: boolean;
  readonly workspaceLayoutElement: HTMLElement | null;
  readonly widthStorageKey: string;
  readonly sheetAnimationDurationMs: number;
  readonly onCloseSheet: () => void;
};

/**
 * The right panel, inline beside the chat column or as a sheet on narrow
 * layouts. Its width follows a resize drag every frame, so the width state
 * lives here rather than in ChatView.
 */
export function ChatRightPanel(props: ChatRightPanelProps) {
  const mobile = useMediaQuery({ max: "lg", pointer: "coarse" });
  const {
    threadRef,
    sheet,
    workspaceLayoutElement,
    widthStorageKey,
    sheetAnimationDurationMs,
    onCloseSheet,
    maximized,
    layoutControls,
    ...tabs
  } = props;
  const inlineSize = usePreviewPanelInlineSize({
    container: workspaceLayoutElement,
    widthStorageKey,
  });
  const activeSurface = tabs.surfaces.find((surface) => surface.id === tabs.activeSurfaceId);
  if (mobile && activeSurface?.kind === "terminal") {
    return (
      <MobileTerminalSheet threadRef={threadRef} open={tabs.open === true}>
        <RightPanelTabs
          {...tabs}
          mode="sheet"
          inlineSize={inlineSize}
          layoutControls={layoutControls}
        />
      </MobileTerminalSheet>
    );
  }
  if (!sheet) {
    return <RightPanelTabs {...tabs} mode="inline" maximized={maximized} inlineSize={inlineSize} />;
  }
  return (
    <RightPanelSheet
      animationDurationMs={sheetAnimationDurationMs}
      open={tabs.open === true}
      onClose={onCloseSheet}
    >
      <RightPanelTabs
        {...tabs}
        mode="sheet"
        inlineSize={inlineSize}
        layoutControls={layoutControls}
      />
    </RightPanelSheet>
  );
}
