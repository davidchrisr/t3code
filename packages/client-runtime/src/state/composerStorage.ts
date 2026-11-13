// @effect-diagnostics globalTimers:off -- Debounces platform store notifications outside the Effect runtime.
import {
  WS_METHODS,
  type ComposerPublishInput,
  type ComposerRemoteEntry,
} from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

export function createComposerStorageAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    publish: createEnvironmentRpcCommand(runtime, {
      label: "composer:publish",
      tag: WS_METHODS.composerPublish,
    }),
    copy: createEnvironmentRpcCommand(runtime, {
      label: "composer:copy",
      tag: WS_METHODS.composerCopy,
    }),
    entries: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "composer:entries",
      tag: WS_METHODS.composerSubscribe,
      idleTtlMs: 0,
    }),
  };
}

export function createComposerPublisher(input: {
  readonly publish: (snapshot: ComposerPublishInput) => Promise<void>;
  readonly onError: (error: unknown) => void;
  readonly onSuccess: () => void;
}) {
  const latest = new Map<string, ComposerPublishInput>();
  const sent = new Map<string, string>();
  const dirty = new Set<string>();
  const failures = new Map<string, unknown>();
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let disposed = false;
  let paused = false;
  const keyFor = (snapshot: ComposerPublishInput) => snapshot.threadId ?? "stash";
  const flush = (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (running !== undefined) return running;
    const work = async () => {
      for (;;) {
        if (disposed || paused) return;
        const key = dirty.values().next().value;
        if (key === undefined) {
          if (failures.size === 0) input.onSuccess();
          return;
        }
        dirty.delete(key);
        const snapshot = latest.get(key);
        if (snapshot === undefined) continue;
        const serialized = JSON.stringify(snapshot);
        if (sent.get(key) === serialized && !failures.has(key)) continue;
        const startedIn = generation;
        try {
          await input.publish(snapshot);
          if (startedIn === generation) {
            sent.set(key, serialized);
            if (failures.delete(key) && failures.size > 0) {
              input.onError([...failures.values()].at(-1));
            }
          }
        } catch (error) {
          if (startedIn === generation && !disposed) {
            failures.set(key, error);
            input.onError(error);
          }
        }
      }
    };
    running = work().finally(() => {
      running = undefined;
    });
    return running;
  };
  return {
    update(snapshot: ComposerPublishInput) {
      if (disposed) return;
      latest.set(keyFor(snapshot), snapshot);
      dirty.add(keyFor(snapshot));
      if (paused) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        void flush();
      }, 500);
    },
    reconnect() {
      if (disposed) return;
      paused = false;
      generation += 1;
      sent.clear();
      for (const key of latest.keys()) dirty.add(key);
      void flush();
    },
    flush,
    pause() {
      paused = true;
      generation += 1;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      dirty.clear();
      latest.clear();
      sent.clear();
      failures.clear();
    },
  };
}

export function groupComposerEntries(entries: ReadonlyArray<ComposerRemoteEntry>) {
  const groups = new Map<string, ComposerRemoteEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.sessionId, entry.clientId]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  return [...groups];
}
