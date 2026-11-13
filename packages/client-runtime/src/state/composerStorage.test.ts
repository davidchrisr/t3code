import { describe, expect, it, vi } from "vite-plus/test";
import { ThreadId, type ComposerPublishInput } from "@t3tools/contracts";
import { createComposerPublisher } from "./composerStorage.ts";

const snapshot: ComposerPublishInput = {
  clientId: "client",
  clientName: "Mac",
  threadId: ThreadId.make("thread"),
  entries: [],
};

describe("composer publisher", () => {
  it("keeps failed scopes visible across unrelated flushes until their writes succeed", async () => {
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    const failing = new Set(["a", "d"]);
    let error: string | null = null;
    const writes: string[] = [];
    const publisher = createComposerPublisher({
      publish: async (value) => {
        const id = value.threadId!;
        writes.push(id);
        if (failing.has(id)) throw new Error(id);
      },
      onError: (failure) => {
        error = failure instanceof Error ? failure.message : String(failure);
      },
      onSuccess: () => {
        error = null;
      },
    });
    using _publisher = { [Symbol.dispose]: () => publisher.dispose() };
    const update = async (id: string) => {
      publisher.update({ ...snapshot, threadId: ThreadId.make(id) });
      await publisher.flush();
    };
    await update("b");
    await update("a");
    expect(error).toBe("a");
    await publisher.flush();
    expect(error).toBe("a");
    await update("b");
    expect(writes).toEqual(["b", "a"]);
    expect(error).toBe("a");
    await update("d");
    expect(error).toBe("d");
    failing.delete("d");
    await update("d");
    expect(error).toBe("a");
    await update("c");
    expect(error).toBe("a");
    failing.delete("a");
    await update("a");
    expect(error).toBeNull();
  });
  it("serializes writes and publishes a clear that arrives during an older save", async () => {
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    const writes: ComposerPublishInput[] = [];
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const publisher = createComposerPublisher({
      publish: async (value) => {
        writes.push(value);
        if (writes.length === 1) await gate;
      },
      onError: (error) => {
        throw error;
      },
      onSuccess: () => {},
    });
    const filled = {
      ...snapshot,
      entries: [
        {
          id: "draft",
          createdAt: "2026-01-01",
          prompt: "Draft",
          attachments: [],
          droppedImageNames: [],
        },
      ],
    };
    publisher.update(filled);
    const saving = publisher.flush();
    publisher.update(snapshot);
    finish();
    await saving;
    expect(writes).toEqual([filled, snapshot]);
    await publisher.flush();
    expect(writes).toHaveLength(2);
    publisher.reconnect();
    await publisher.flush();
    expect(writes).toEqual([filled, snapshot, snapshot]);
    publisher.pause();
    publisher.update(filled);
    await vi.runAllTimersAsync();
    expect(writes).toEqual([filled, snapshot, snapshot]);
    publisher.reconnect();
    await publisher.flush();
    expect(writes).toEqual([filled, snapshot, snapshot, filled]);
    publisher.update(filled);
    publisher.dispose();
    await vi.runAllTimersAsync();
    expect(writes).toEqual([filled, snapshot, snapshot, filled]);
  });
  it("republishes after reconnect even when the previous connection acknowledges a late save", async () => {
    vi.useFakeTimers();
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    let finish: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const publish = vi.fn(async () => {
      if (publish.mock.calls.length === 1) await gate;
    });
    const publisher = createComposerPublisher({
      publish,
      onError: (error) => {
        throw error;
      },
      onSuccess: () => {},
    });
    publisher.update(snapshot);
    const saving = publisher.flush();
    publisher.reconnect();
    finish();
    await saving;
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
