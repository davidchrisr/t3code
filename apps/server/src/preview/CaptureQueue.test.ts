import { expect, it, vi } from "vite-plus/test";
import { CaptureQueue } from "./CaptureQueue.ts";

it("expires lock waiters without starting them late or overlapping the running capture", async () => {
  vi.useFakeTimers();
  try {
    const queue = new CaptureQueue();
    const running = Promise.withResolvers<void>();
    const first = queue.run(
      () => running.promise,
      10_000,
      () => new Error("running"),
    );
    const waiting = vi.fn(async () => {});
    const expired = expect(queue.run(waiting, 1_000, () => new Error("waiting"))).rejects.toThrow(
      "waiting",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await expired;
    const nextStarted = Promise.withResolvers<void>();
    const next = queue.run(
      async () => {
        nextStarted.resolve();
      },
      10_000,
      () => new Error("next"),
    );
    expect(waiting).not.toHaveBeenCalled();
    running.resolve();
    await Promise.all([first, next, nextStarted.promise]);
    expect(waiting).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("releases the caller and queue when an active capture does not settle", async () => {
  vi.useFakeTimers();
  try {
    const queue = new CaptureQueue();
    const started = Promise.withResolvers<AbortSignal>();
    const first = expect(
      queue.run(
        (signal) => {
          started.resolve(signal);
          return new Promise<void>(() => {});
        },
        1_000,
        () => new Error("capture"),
      ),
    ).rejects.toThrow("capture");
    const signal = await started.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    expect(signal.aborted).toBe(true);
    await expect(
      queue.run(
        async () => "next",
        1_000,
        () => new Error("next"),
      ),
    ).resolves.toBe("next");
  } finally {
    vi.useRealTimers();
  }
});
