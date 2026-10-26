import { useRef, type ReactNode } from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { hideThreadTerminalPanels } from "../../lib/hideThreadTerminalPanels";
import { Button } from "../ui/button";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";

export function MobileTerminalSheet({
  threadRef,
  open,
  children,
}: {
  threadRef: ScopedThreadRef;
  open: boolean;
  children: ReactNode;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const close = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && popupRef.current?.contains(focused)) focused.blur();
    hideThreadTerminalPanels(threadRef);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <SheetPopup
        ref={popupRef}
        variant="fullscreen"
        side="bottom"
        keepMounted
        showCloseButton={false}
        initialFocus={false}
        finalFocus={false}
        transitionDurationMs={0}
      >
        <div className="shrink-0 border-b pt-safe">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <SheetTitle>Terminal</SheetTitle>
            <Button variant="ghost" onClick={close}>
              Back to chat
            </Button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pb-safe">{children}</div>
      </SheetPopup>
    </Sheet>
  );
}
