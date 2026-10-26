import type { ScopedThreadRef } from "@t3tools/contracts";

import { useRightPanelStore } from "../rightPanelStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";

export function hideThreadTerminalPanels(threadRef: ScopedThreadRef) {
  useTerminalUiStateStore.getState().setTerminalOpen(threadRef, false);
  const panels = useRightPanelStore.getState();
  panels.setMaximized(threadRef, false);
  panels.close(threadRef);
}
