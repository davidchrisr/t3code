import { useEffect } from "react";

import { observeMobileSidebarSwipe } from "../lib/mobileSidebarSwipe";

export function useMobileSidebarSwipe({
  enabled,
  open,
  onOpenChange,
}: {
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Document touch listeners must follow the mounted sidebar and its current visibility.
  useEffect(() => {
    if (!enabled) return;
    return observeMobileSidebarSwipe(document, { open, onOpenChange });
  }, [enabled, onOpenChange, open]);
}
