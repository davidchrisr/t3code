import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { describe, expect, it } from "vite-plus/test";

import { createChatShortcutContextRegistry } from "./activeChatShortcutContext";
import {
  effectiveShortcutsForCommand,
  resolveShortcutCommand,
  type ShortcutMatchContext,
} from "./keybindings";

const baseContext = {
  terminalFocus: false,
  terminalOpen: false,
  previewFocus: false,
  previewOpen: false,
  editableFocus: false,
  isDesktop: true,
  isWeb: false,
} satisfies ShortcutMatchContext;

const event = {
  key: "Tab",
  code: "Tab",
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

describe("active chat shortcut context", () => {
  it.each([
    "previewOpen",
    "composerFocus",
    "draftThreadRoute",
    "turnRunning",
    "composerRequiresModifier",
  ])("resolves positive and negative %s conditions using the active chat", (condition) => {
    const registry = createChatShortcutContextRegistry();
    let enabled = true;
    registry.register(() => ({ ...baseContext, [condition]: enabled }));
    const keybindings = compileResolvedKeybindingsConfig([
      { key: "ctrl+tab", command: "thread.cycleRecent", when: condition },
      { key: "ctrl+tab", command: "chat.find", when: `!${condition}` },
    ]);
    const resolve = () =>
      resolveShortcutCommand(event, keybindings, {
        platform: "MacIntel",
        context: registry.read(null)!,
      });
    expect(resolve()).toBe("thread.cycleRecent");
    enabled = false;
    expect(resolve()).toBe("chat.find");
  });

  it("updates guest forwarding eligibility only when the live context changes", () => {
    const registry = createChatShortcutContextRegistry();
    let running = false;
    registry.register(() => ({ ...baseContext, turnRunning: running }));
    const keybindings = compileResolvedKeybindingsConfig([
      {
        key: "ctrl+tab",
        command: "thread.cycleRecent",
        when: "turnRunning && previewFocus && !composerFocus",
      },
    ]);
    const forwarded: number[] = [];
    const refresh = () =>
      forwarded.push(
        effectiveShortcutsForCommand(keybindings, "thread.cycleRecent", {
          platform: "MacIntel",
          context: {
            ...registry.read(null),
            previewFocus: true,
            previewOpen: true,
            composerFocus: false,
          },
        }).length,
      );
    const unsubscribe = registry.subscribe(refresh);
    refresh();
    registry.refresh();
    expect(forwarded).toEqual([0]);
    running = true;
    registry.refresh();
    registry.refresh();
    expect(forwarded).toEqual([0, 1]);
    running = false;
    registry.refresh();
    expect(forwarded).toEqual([0, 1, 0]);
    unsubscribe();
  });

  it("keeps a newer chat's context when an older chat cleans up", () => {
    const registry = createChatShortcutContextRegistry();
    const closeFirst = registry.register(() => ({ ...baseContext, previewOpen: true }));
    const closeSecond = registry.register(() => ({
      ...baseContext,
      previewOpen: false,
      composerFocus: true,
    }));
    closeFirst();
    expect(registry.read(null)).toMatchObject({ previewOpen: false, composerFocus: true });
    closeSecond();
    expect(registry.read(null)).toBeUndefined();
  });
});
