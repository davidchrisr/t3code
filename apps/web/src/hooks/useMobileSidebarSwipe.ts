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
  useEffect(() => {
    if (!enabled) return;
    return observeMobileSidebarSwipe(document, { open, onOpenChange });
  }, [enabled, onOpenChange, open]);
}
