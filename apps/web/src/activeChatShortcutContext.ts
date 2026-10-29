import type { ShortcutMatchContext } from "./keybindings";

type ReadShortcutContext = (target: EventTarget | null) => ShortcutMatchContext;

export function createChatShortcutContextRegistry() {
  let active: { read: ReadShortcutContext } | null = null;
  let snapshot: ShortcutMatchContext | undefined;
  const listeners = new Set<() => void>();

  const refresh = () => {
    const next = active?.read(null);
    if (Object.keys({ ...snapshot, ...next }).every((key) => snapshot?.[key] === next?.[key]))
      return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    read: (target: EventTarget | null) => active?.read(target),
    refresh,
    register(read: ReadShortcutContext) {
      const owner = { read };
      active = owner;
      refresh();
      return () => {
        if (active !== owner) return;
        active = null;
        refresh();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const activeChatShortcutContext = createChatShortcutContextRegistry();
