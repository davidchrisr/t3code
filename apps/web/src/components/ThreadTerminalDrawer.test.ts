import { describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_RESOLVED_KEYBINDINGS,
} from "@t3tools/shared/keybindings";
import {
  applyTerminalAttachStreamEvent,
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  INITIAL_TERMINAL_OUTPUT_CURSOR,
  nextTerminalAttachSeedState,
} from "@t3tools/client-runtime/state/terminal";

import {
  shouldClearTerminalSelectionAction,
  shouldHandleTerminalExit,
  shouldBypassTerminalInput,
  synchronizeTerminalOutput,
} from "./ThreadTerminalDrawer";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";

vi.mock("../env", () => ({ isElectron: true }));

const threadRef = scopeThreadRef(
  EnvironmentId.make("shortcut-environment"),
  ThreadId.make("thread"),
);

function mockTerminalDrawerOpen(terminalOpen: boolean) {
  const state = useTerminalUiStateStore.getState();
  return vi.spyOn(useTerminalUiStateStore, "getState").mockReturnValue({
    ...state,
    terminalUiStateByThreadKey: {
      [scopedThreadKey(threadRef)]: {
        ...selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef),
        terminalOpen,
      },
    },
  });
}

function shortcutEvent() {
  return {
    key: "g",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: vi.fn(),
  };
}

describe("terminal thread shortcuts", () => {
  it.each([false, true])("yields all desktop thread jumps with drawer open=%s", (terminalOpen) => {
    using _drawer = mockTerminalDrawerOpen(terminalOpen);
    for (const platform of ["MacIntel", "Linux"]) {
      for (let index = 1; index <= 9; index += 1) {
        const event = {
          ...shortcutEvent(),
          key: String(index),
          metaKey: platform === "MacIntel",
          ctrlKey: platform === "Linux",
        };
        expect(
          shouldBypassTerminalInput(event, DEFAULT_RESOLVED_KEYBINDINGS, threadRef, platform),
        ).toBe(true);
        expect(event.preventDefault).not.toHaveBeenCalled();
      }
    }
  });

  it("keeps an inactive drawer-conditioned shortcut available to a panel terminal", () => {
    using _drawer = mockTerminalDrawerOpen(false);
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "ctrl+g", command: "thread.jump.1", when: "terminalOpen" },
    ]);
    expect(shouldBypassTerminalInput(shortcutEvent(), keybindings, threadRef, "Linux")).toBe(false);
  });

  it("yields to a panel thread jump conditioned on the drawer being closed", () => {
    using _drawer = mockTerminalDrawerOpen(false);
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "ctrl+g", command: "thread.jump.1", when: "!terminalOpen" },
    ]);
    const event = shortcutEvent();
    expect(shouldBypassTerminalInput(event, keybindings, threadRef, "Linux")).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("follows the drawer's current state when it opens", () => {
    using _drawer = mockTerminalDrawerOpen(true);
    for (const [when, expected] of [
      ["terminalOpen", true],
      ["!terminalOpen", false],
    ] as const) {
      const keybindings = compileResolvedKeybindingsConfig([
        { key: "ctrl+g", command: "thread.jump.1", when },
      ]);
      expect(shouldBypassTerminalInput(shortcutEvent(), keybindings, threadRef, "Linux")).toBe(
        expected,
      );
    }
  });

  it("respects thread jump focus conditions and later command precedence", () => {
    using _drawer = mockTerminalDrawerOpen(false);
    const restricted = compileResolvedKeybindingsConfig([
      { key: "ctrl+g", command: "thread.jump.1", when: "!terminalFocus" },
    ]);
    expect(shouldBypassTerminalInput(shortcutEvent(), restricted, threadRef, "Linux")).toBe(false);

    const shadowed = compileResolvedKeybindingsConfig([
      { key: "ctrl+g", command: "thread.jump.1" },
      { key: "ctrl+g", command: "sidebar.toggle" },
    ]);
    expect(shouldBypassTerminalInput(shortcutEvent(), shadowed, threadRef, "Linux")).toBe(false);
  });

  it("leaves ordinary terminal typing alone", () => {
    using _drawer = mockTerminalDrawerOpen(false);
    const event = { ...shortcutEvent(), key: "1", ctrlKey: false };
    expect(shouldBypassTerminalInput(event, DEFAULT_RESOLVED_KEYBINDINGS, threadRef, "Linux")).toBe(
      false,
    );
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("keeps terminal controls available in a panel with the drawer closed", () => {
    using _drawer = mockTerminalDrawerOpen(false);
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "ctrl+g", command: "terminal.split", when: "terminalOpen" },
    ]);
    expect(shouldBypassTerminalInput(shortcutEvent(), keybindings, threadRef, "Linux")).toBe(true);
  });

  it.each([false, true])("prevents browser close for a terminal close with repeat=%s", (repeat) => {
    using _drawer = mockTerminalDrawerOpen(false);
    const event = { ...shortcutEvent(), key: "w", repeat };
    expect(shouldBypassTerminalInput(event, DEFAULT_RESOLVED_KEYBINDINGS, threadRef, "Linux")).toBe(
      true,
    );
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});

describe("terminal selection actions", () => {
  it("does not let an old selection popup cancel its replacement right-click menu", () => {
    expect(
      shouldClearTerminalSelectionAction({
        actionPending: false,
        openMenuRequestId: 3,
        currentRequestId: 4,
      }),
    ).toBe(false);
    expect(
      shouldClearTerminalSelectionAction({
        actionPending: false,
        openMenuRequestId: null,
        currentRequestId: 4,
      }),
    ).toBe(false);
  });

  it("handles an exit that lands while the terminal surface is still loading", () => {
    expect(shouldHandleTerminalExit("exited", "running", false, 1)).toBe(true);
    expect(shouldHandleTerminalExit("exited", "exited", false, 1)).toBe(false);
    expect(shouldHandleTerminalExit("closed", "running", true, 1)).toBe(false);
  });
});

it("retains visible output and selection until a replacement subscription receives its snapshot", () => {
  const terminal = { resetAndWrite: vi.fn(), write: vi.fn(), clearSelection: vi.fn() };
  const snapshot = {
    threadId: "thread",
    terminalId: "term-1",
    cwd: "/repo",
    worktreePath: null,
    status: "running" as const,
    pid: 123,
    history: "host output",
    exitCode: null,
    exitSignal: null,
    label: "Terminal 1",
    updatedAt: "2026-09-05T00:00:00.000Z",
  };
  const attached = applyTerminalAttachStreamEvent(nextTerminalAttachSeedState(), {
    type: "snapshot",
    snapshot,
  });
  const cursor = synchronizeTerminalOutput(terminal, attached, INITIAL_TERMINAL_OUTPUT_CURSOR);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("host output");
  terminal.resetAndWrite.mockClear();
  terminal.clearSelection.mockClear();

  const pending = combineTerminalSessionState(
    { ...snapshot, hasRunningSubprocess: false },
    EMPTY_TERMINAL_BUFFER_STATE,
  );
  expect(pending.status).toBe("running");
  expect(synchronizeTerminalOutput(terminal, pending, cursor)).toBe(cursor);
  expect(terminal.resetAndWrite).not.toHaveBeenCalled();
  expect(terminal.write).not.toHaveBeenCalled();
  expect(terminal.clearSelection).not.toHaveBeenCalled();

  const observed = applyTerminalAttachStreamEvent(nextTerminalAttachSeedState(), {
    type: "snapshot",
    snapshot: { ...snapshot, history: "host output\nobserved output" },
  });
  const observedCursor = synchronizeTerminalOutput(terminal, observed, cursor);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("host output\nobserved output");

  const cleared = applyTerminalAttachStreamEvent(observed, {
    type: "cleared",
    threadId: "thread",
    terminalId: "term-1",
  });
  synchronizeTerminalOutput(terminal, cleared, observedCursor);
  expect(terminal.resetAndWrite).toHaveBeenLastCalledWith("");
});
