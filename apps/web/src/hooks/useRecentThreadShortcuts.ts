import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { threadSearchSubject } from "@t3tools/client-runtime/state/thread-search";
import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { filterSidebarV2VisibleThreads } from "../components/Sidebar.logic";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { createRecentThreadCycle } from "../recentThreadCycle";
import { useStableCallback } from "./useStableCallback";
import { activeChatShortcutContext } from "../activeChatShortcutContext";

export function useRecentThreadShortcuts(input: {
  readonly threads: readonly EnvironmentThreadShell[];
  readonly currentThreadRef: ScopedThreadRef | null;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly terminalOpen: boolean;
  readonly navigateToThread: (ref: ScopedThreadRef) => unknown;
}) {
  const navigate = useStableCallback((key: string) => {
    const ref = parseScopedThreadKey(key);
    if (ref) void input.navigateToThread(ref);
  });
  const [cycle] = useState(() => createRecentThreadCycle(navigate));
  const currentKey = input.currentThreadRef ? scopedThreadKey(input.currentThreadRef) : null;
  // oxlint-disable-next-line t3code/react-effect-budget -- Acknowledge rendered routes in the keyboard cycle controller.
  useLayoutEffect(() => {
    if (currentKey !== null) cycle.visit(currentKey);
  }, [currentKey, cycle]);

  const advance = useEffectEvent(() => {
    const recentThreads = filterSidebarV2VisibleThreads(input.threads, null)
      .filter((thread) => thread.deletedAt === null)
      .map((thread) => ({
        thread,
        openedAt: threadSearchSubject(thread, null).opens?.openedAt ?? 0,
      }))
      .filter(
        ({ thread, openedAt }) =>
          openedAt > 0 ||
          scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)) === currentKey,
      )
      .toSorted((left, right) => right.openedAt - left.openedAt);
    cycle.next(
      recentThreads.map(({ thread }) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
      currentKey,
    );
  });

  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      isCommandPaletteOpen() ||
      isModelPickerOpen() ||
      (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
    )
      return;
    const command = resolveShortcutCommand(event, input.keybindings, {
      context: {
        terminalFocus: isTerminalFocused(),
        terminalOpen: input.terminalOpen,
        editableFocus: isEditableFocused(event.target),
        previewFocus: isPreviewFocused(),
        ...activeChatShortcutContext.read(event.target),
      },
    });
    if (command !== "thread.cycleRecent") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    advance();
    if (!event.ctrlKey && !event.metaKey && !event.altKey) cycle.finish();
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- Subscribe to window input and desktop IPC for the mounted shortcut scope.
  useEffect(() => {
    const finish = () => cycle.finish();
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta" || event.key === "Alt") finish();
    };
    const onKeyDown = (event: KeyboardEvent) => handleKeyDown(event);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "thread.cycleRecent.end") finish();
      if (action === "thread.cycleRecent" && !isCommandPaletteOpen() && !isModelPickerOpen())
        advance();
    });
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", finish);
    window.addEventListener("pointerdown", finish, true);
    return () => {
      finish();
      unsubscribe?.();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", finish);
      window.removeEventListener("pointerdown", finish, true);
    };
  }, [cycle]);
}
