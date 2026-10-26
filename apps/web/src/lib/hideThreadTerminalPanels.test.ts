import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { hideThreadTerminalPanels } from "./hideThreadTerminalPanels";

function setup() {
  const previousTerminals = useTerminalUiStateStore.getState();
  const previousPanels = useRightPanelStore.getState();
  useTerminalUiStateStore.setState(useTerminalUiStateStore.getInitialState());
  useRightPanelStore.setState(useRightPanelStore.getInitialState());
  const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("thread"));
  const otherEnvironment = scopeThreadRef(EnvironmentId.make("remote"), threadRef.threadId);
  const otherThread = scopeThreadRef(threadRef.environmentId, ThreadId.make("other-thread"));
  const terminals = useTerminalUiStateStore.getState();
  const panels = useRightPanelStore.getState();
  for (const ref of [threadRef, otherEnvironment, otherThread]) {
    terminals.ensureTerminal(ref, "drawer-terminal", { open: true, active: true });
    panels.openTerminal(ref, "panel-terminal");
    panels.setMaximized(ref, true);
  }
  const readTerminals = (ref: typeof threadRef) =>
    selectThreadTerminalUiState(useTerminalUiStateStore.getState().terminalUiStateByThreadKey, ref);
  const readPanels = (ref: typeof threadRef) =>
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
  return {
    threadRef,
    otherEnvironment,
    otherThread,
    readTerminals,
    readPanels,
    [Symbol.dispose]() {
      useTerminalUiStateStore.setState(previousTerminals);
      useRightPanelStore.setState(previousPanels);
    },
  };
}

it("returns to chat with both placements hidden and every terminal session retained", () => {
  using state = setup();
  const drawerBefore = state.readTerminals(state.threadRef);
  const panelBefore = state.readPanels(state.threadRef);

  hideThreadTerminalPanels(state.threadRef);

  const drawerAfter = state.readTerminals(state.threadRef);
  const panelAfter = state.readPanels(state.threadRef);
  expect(drawerAfter.terminalOpen).toBe(false);
  expect(panelAfter.isOpen).toBe(false);
  expect(panelAfter.maximized).not.toBe(true);
  expect(drawerAfter.terminalIds).toEqual(drawerBefore.terminalIds);
  expect(drawerAfter.terminalGroups).toEqual(drawerBefore.terminalGroups);
  expect(drawerAfter.activeTerminalId).toBe(drawerBefore.activeTerminalId);
  expect(panelAfter.surfaces).toBe(panelBefore.surfaces);
  expect(panelAfter.activeSurfaceId).toBe(panelBefore.activeSurfaceId);
});

it("leaves other threads and environments open", () => {
  using state = setup();
  const otherThread = state.readPanels(state.otherThread);
  const otherEnvironment = state.readPanels(state.otherEnvironment);

  hideThreadTerminalPanels(state.threadRef);

  for (const ref of [state.otherThread, state.otherEnvironment]) {
    expect(state.readTerminals(ref).terminalOpen).toBe(true);
    expect(state.readPanels(ref)).toMatchObject({ isOpen: true, maximized: true });
  }
  expect(state.readPanels(state.otherThread)).toBe(otherThread);
  expect(state.readPanels(state.otherEnvironment)).toBe(otherEnvironment);
});
